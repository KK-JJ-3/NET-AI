
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from training.prepare import prepare_dataset


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

PROJECT_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_DIR / "models"

ANOMALY_MODEL_PATH = MODEL_DIR / "isolation_forest.joblib"
CLASSIFIER_MODEL_PATH = MODEL_DIR / "random_forest.joblib"
FEATURE_IMPORTANCE_PATH = MODEL_DIR / "feature_importance.json"
NORMAL_BASELINE_PATH = MODEL_DIR / "normal_baseline.json"
EVALUATION_PATH = MODEL_DIR / "evaluation_results.json"

RANDOM_SEED = 42
WINDOW_SIZE = 15
FUTURE_HORIZON_MINUTES = 30
EPISODE_DURATION_MINUTES = 60

ANOMALY_CONTAMINATION = 0.05
CLASSIFIER_ESTIMATORS = 200
CLASSIFIER_MAX_DEPTH = 10

FAULT_CLASSES = [
    "normal",
    "congestion",
    "device_failure",
]


# ---------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------

def validate_dataset(
    x_train: pd.DataFrame,
    x_test: pd.DataFrame,
    y_train: pd.Series,
    y_test: pd.Series,
) -> None:
    """Validate the prepared training and test datasets."""

    if x_train.empty or x_test.empty:
        raise ValueError(
            "Training and test feature datasets must not be empty."
        )

    if len(y_train) != len(x_train):
        raise ValueError(
            "Training feature and label counts do not match."
        )

    if len(y_test) != len(x_test):
        raise ValueError(
            "Test feature and label counts do not match."
        )

    if list(x_train.columns) != list(x_test.columns):
        raise ValueError(
            "Training and test feature columns do not match."
        )

    if not np.isfinite(x_train.to_numpy(dtype=float)).all():
        raise ValueError(
            "Training features contain NaN or infinite values."
        )

    if not np.isfinite(x_test.to_numpy(dtype=float)).all():
        raise ValueError(
            "Test features contain NaN or infinite values."
        )

    normalized_train_labels = set(
        y_train.astype(str).str.strip().str.lower()
    )

    normalized_test_labels = set(
        y_test.astype(str).str.strip().str.lower()
    )

    unknown_train = normalized_train_labels - set(FAULT_CLASSES)
    unknown_test = normalized_test_labels - set(FAULT_CLASSES)

    if unknown_train:
        raise ValueError(
            f"Unknown training labels: {sorted(unknown_train)}"
        )

    if unknown_test:
        raise ValueError(
            f"Unknown test labels: {sorted(unknown_test)}"
        )

    missing_train_classes = set(FAULT_CLASSES) - normalized_train_labels

    if missing_train_classes:
        raise ValueError(
            "Training data is missing required classes: "
            f"{sorted(missing_train_classes)}. "
            "Check simulator scenarios and future-label generation."
        )


def normalize_labels(labels: pd.Series) -> pd.Series:
    """Normalize target labels consistently."""

    return (
        labels.astype(str)
        .str.strip()
        .str.lower()
        .reset_index(drop=True)
    )


# ---------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------

def evaluate_model(
    classifier: FaultClassifier,
    x_test: pd.DataFrame,
    y_test: pd.Series,
) -> dict[str, Any]:
    """Evaluate the future-fault classifier on held-out episodes."""

    if x_test.empty or len(y_test) == 0:
        raise ValueError("The test dataset is empty.")

    if len(x_test) != len(y_test):
        raise ValueError(
            "Test features and labels have different lengths."
        )

    actual = normalize_labels(y_test).to_numpy()

    predicted = np.asarray(
        classifier.predict(x_test.to_numpy(dtype=float))
    ).astype(str)

    predicted = np.char.lower(
        np.char.strip(predicted)
    )

    accuracy = float(
        accuracy_score(actual, predicted)
    )

    report = classification_report(
        actual,
        predicted,
        labels=FAULT_CLASSES,
        output_dict=True,
        zero_division=0,
    )

    matrix = confusion_matrix(
        actual,
        predicted,
        labels=FAULT_CLASSES,
    )

    # A false positive here means a normal future window was
    # incorrectly classified as a future fault.
    normal_mask = actual == "normal"
    normal_count = int(normal_mask.sum())

    false_positive_count = int(
        np.sum(normal_mask & (predicted != "normal"))
    )

    false_positive_rate = (
        false_positive_count / normal_count
        if normal_count > 0
        else None
    )

    # Count faults the model failed to warn about.
    fault_mask = actual != "normal"
    fault_count = int(fault_mask.sum())

    missed_fault_count = int(
        np.sum(fault_mask & (predicted == "normal"))
    )

    return {
        "task": "future_fault_prediction",
        "future_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "test_samples": int(len(x_test)),
        "accuracy": accuracy,
        "accuracy_percent": round(accuracy * 100, 2),
        "classification_report": report,
        "confusion_matrix": {
            "labels": FAULT_CLASSES,
            "matrix": matrix.tolist(),
        },
        "normal_samples": normal_count,
        "normal_false_positives": false_positive_count,
        "normal_false_positive_rate": (
            float(false_positive_rate)
            if false_positive_rate is not None
            else None
        ),
        "normal_false_positive_rate_percent": (
            round(false_positive_rate * 100, 2)
            if false_positive_rate is not None
            else None
        ),
        "future_fault_samples": fault_count,
        "missed_future_faults": missed_fault_count,
        "future_fault_miss_rate": (
            missed_fault_count / fault_count
            if fault_count > 0
            else None
        ),
    }


# ---------------------------------------------------------------------
# Feature importance and baseline
# ---------------------------------------------------------------------

def save_feature_importance(
    classifier: FaultClassifier,
    feature_names: list[str],
) -> None:
    """Save classifier feature importance values."""

    importances = classifier.feature_importances()

    if len(feature_names) != len(importances):
        raise ValueError(
            "Feature importance count does not match feature count."
        )

    ranked_importances = {
        name: float(importance)
        for name, importance in zip(
            feature_names,
            importances,
        )
    }

    ranked_importances = dict(
        sorted(
            ranked_importances.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    )

    FEATURE_IMPORTANCE_PATH.write_text(
        json.dumps(ranked_importances, indent=2),
        encoding="utf-8",
    )


def save_normal_baseline(
    x_train_with_anomaly: pd.DataFrame,
    y_train: pd.Series,
) -> None:
    """Save mean features for training examples labelled normal."""

    labels = normalize_labels(y_train)

    normal_mask = labels.eq("normal").to_numpy()

    if not normal_mask.any():
        raise ValueError(
            "No normal training examples are available for the baseline."
        )

    normal_rows = x_train_with_anomaly.loc[normal_mask]

    baseline = {
        column: float(value)
        for column, value in normal_rows.mean().items()
    }

    NORMAL_BASELINE_PATH.write_text(
        json.dumps(baseline, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------

def train_models() -> None:
    """Train, evaluate, and save the future-fault prediction models."""

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("Preparing future-labelled telemetry windows...")
    print(
        f"Forecast horizon: {FUTURE_HORIZON_MINUTES} minutes"
    )
    print(f"Telemetry window: {WINDOW_SIZE} readings")
    print(
        f"Episode duration: {EPISODE_DURATION_MINUTES} minutes"
    )
    print()

    (
        x_train,
        x_test,
        y_train,
        y_test,
    ) = prepare_dataset(
        random_seed=RANDOM_SEED,
        window_size=WINDOW_SIZE,
        future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        duration_minutes=EPISODE_DURATION_MINUTES,
    )

    y_train = normalize_labels(y_train)
    y_test = normalize_labels(y_test)

    validate_dataset(
        x_train,
        x_test,
        y_train,
        y_test,
    )

    print("DATASET SUMMARY")
    print("----------------")
    print(f"Training samples: {len(x_train)}")
    print(f"Test samples:     {len(x_test)}")
    print(f"Base features:    {len(x_train.columns)}")
    print()
    print("Training target distribution:")
    print(y_train.value_counts().to_string())
    print()
    print("Test target distribution:")
    print(y_test.value_counts().to_string())
    print()

    # Fit the anomaly detector exactly once.
    # This same fitted detector generates the anomaly scores used
    # for classifier training, testing, and live inference.
    print("Training Isolation Forest...")

    anomaly_detector = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )

    train_array = x_train.to_numpy(dtype=float)
    test_array = x_test.to_numpy(dtype=float)

    anomaly_detector.fit(train_array)

    train_anomaly_scores = anomaly_detector.anomaly_score(
        train_array
    )

    test_anomaly_scores = anomaly_detector.anomaly_score(
        test_array
    )

    x_train_with_anomaly = x_train.copy()
    x_test_with_anomaly = x_test.copy()

    x_train_with_anomaly["anomaly_score"] = (
        train_anomaly_scores
    )

    x_test_with_anomaly["anomaly_score"] = (
        test_anomaly_scores
    )

    if list(x_train_with_anomaly.columns) != list(
        x_test_with_anomaly.columns
    ):
        raise ValueError(
            "Training and test features differ after adding anomaly scores."
        )

    # Train the classifier on future fault labels.
    print("Training Random Forest classifier...")

    classifier = FaultClassifier(
        n_estimators=CLASSIFIER_ESTIMATORS,
        max_depth=CLASSIFIER_MAX_DEPTH,
        random_state=RANDOM_SEED,
    )

    classifier.fit(
        x_train_with_anomaly.to_numpy(dtype=float),
        y_train.to_numpy(),
    )

    # Evaluate the trained classifier on held-out episodes.
    print("Evaluating future-fault predictions...")

    evaluation = evaluate_model(
        classifier=classifier,
        x_test=x_test_with_anomaly,
        y_test=y_test,
    )

    # Add useful training metadata to the evaluation file.
    evaluation["training_samples"] = int(len(x_train))
    evaluation["base_feature_count"] = int(len(x_train.columns))
    evaluation["classifier_feature_count"] = int(
        len(x_train_with_anomaly.columns)
    )
    evaluation["random_seed"] = RANDOM_SEED
    evaluation["anomaly_contamination"] = ANOMALY_CONTAMINATION
    evaluation["classifier_estimators"] = CLASSIFIER_ESTIMATORS
    evaluation["classifier_max_depth"] = CLASSIFIER_MAX_DEPTH
    evaluation["training_target_distribution"] = {
        str(key): int(value)
        for key, value in y_train.value_counts().items()
    }
    evaluation["test_target_distribution"] = {
        str(key): int(value)
        for key, value in y_test.value_counts().items()
    }

    # Save the exact fitted anomaly detector used above.
    anomaly_detector.save(
        ANOMALY_MODEL_PATH
    )

    classifier.save(
        CLASSIFIER_MODEL_PATH
    )

    feature_names = list(
        x_train_with_anomaly.columns
    )

    save_feature_importance(
        classifier=classifier,
        feature_names=feature_names,
    )

    save_normal_baseline(
        x_train_with_anomaly=x_train_with_anomaly,
        y_train=y_train,
    )

    EVALUATION_PATH.write_text(
        json.dumps(evaluation, indent=2),
        encoding="utf-8",
    )

    # Report results.
    print()
    print("TRAINING COMPLETE")
    print("-----------------")
    print(f"Anomaly model:       {ANOMALY_MODEL_PATH}")
    print(f"Classifier model:    {CLASSIFIER_MODEL_PATH}")
    print(f"Feature importance:  {FEATURE_IMPORTANCE_PATH}")
    print(f"Normal baseline:     {NORMAL_BASELINE_PATH}")
    print(f"Evaluation results:  {EVALUATION_PATH}")
    print()
    print("EVALUATION SUMMARY")
    print("------------------")
    print(f"Accuracy: {evaluation['accuracy_percent']}%")
    print(
        "Normal false-positive rate: "
        f"{evaluation['normal_false_positive_rate_percent']}%"
        if evaluation["normal_false_positive_rate_percent"] is not None
        else "Normal false-positive rate: unavailable"
    )
    print(
        f"Future faults in test set: "
        f"{evaluation['future_fault_samples']}"
    )
    print(
        f"Missed future faults: "
        f"{evaluation['missed_future_faults']}"
    )
    print()
    print("Classification report:")
    print(
        classification_report(
            y_test,
            classifier.predict(
                x_test_with_anomaly.to_numpy(dtype=float)
            ),
            labels=FAULT_CLASSES,
            zero_division=0,
        )
    )


if __name__ == "__main__":
    train_models()
