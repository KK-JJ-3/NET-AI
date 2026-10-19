from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from training.prepare import prepare_dataset
from training.train_models import (
    ANOMALY_CONTAMINATION,
    ANOMALY_MODEL_PATH,
    CLASSIFIER_MODEL_PATH,
    EPISODE_DURATION_MINUTES,
    EPISODES_PER_CLASS,
    FUTURE_HORIZON_MINUTES,
    RANDOM_SEED,
    WINDOW_SIZE,
    normalize_labels,
)


# These thresholds are evaluated only; this script does not change app settings.
THRESHOLDS = (0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80)
LABELS = ("normal", "congestion", "device_failure")
FAULT_LABELS = ("congestion", "device_failure")


def predictions_for_threshold(
    probability_rows: np.ndarray,
    classes: list[str],
    threshold: float,
) -> np.ndarray:
    """Apply the production decision rule with a configurable risk threshold.

    Production risk is 1 - P(normal). Below the threshold the forecast is
    normal; at/above it, choose the most probable fault class.
    """
    class_indexes = {name: index for index, name in enumerate(classes)}
    missing = set(LABELS) - set(class_indexes)
    if missing:
        raise ValueError(f"Saved classifier is missing classes: {sorted(missing)}")

    normal_index = class_indexes["normal"]
    fault_indexes = [class_indexes[name] for name in FAULT_LABELS]
    predicted: list[str] = []

    for row in probability_rows:
        risk = 1.0 - float(row[normal_index])
        if risk < threshold:
            predicted.append("normal")
        else:
            best_fault_index = max(fault_indexes, key=lambda index: float(row[index]))
            predicted.append(classes[best_fault_index])

    return np.asarray(predicted, dtype=str)


def evaluate_threshold(
    actual: np.ndarray,
    predicted: np.ndarray,
    threshold: float,
) -> dict[str, object]:
    report = classification_report(
        actual,
        predicted,
        labels=list(LABELS),
        output_dict=True,
        zero_division=0,
    )
    matrix = confusion_matrix(actual, predicted, labels=list(LABELS))
    normal_mask = actual == "normal"
    fault_mask = ~normal_mask
    normal_count = int(normal_mask.sum())
    fault_count = int(fault_mask.sum())
    false_positives = int(np.sum(normal_mask & (predicted != "normal")))
    missed_faults = int(np.sum(fault_mask & (predicted == "normal")))

    return {
        "threshold": threshold,
        "accuracy_percent": round(float(accuracy_score(actual, predicted)) * 100, 2),
        "normal_false_positives": false_positives,
        "normal_false_positive_rate_percent": round(
            (false_positives / normal_count * 100) if normal_count else 0.0, 2
        ),
        "missed_future_faults": missed_faults,
        "future_fault_recall_percent": round(
            ((fault_count - missed_faults) / fault_count * 100) if fault_count else 0.0,
            2,
        ),
        "congestion_precision_percent": round(float(report["congestion"]["precision"]) * 100, 2),
        "congestion_recall_percent": round(float(report["congestion"]["recall"]) * 100, 2),
        "device_failure_precision_percent": round(float(report["device_failure"]["precision"]) * 100, 2),
        "device_failure_recall_percent": round(float(report["device_failure"]["recall"]) * 100, 2),
        "macro_f1_percent": round(float(report["macro avg"]["f1-score"]) * 100, 2),
        "confusion_matrix": matrix.tolist(),
        "classification_report": report,
    }


def main() -> None:
    for model_path in (ANOMALY_MODEL_PATH, CLASSIFIER_MODEL_PATH):
        if not model_path.exists():
            raise FileNotFoundError(
                f"Required saved model not found: {model_path}. Train the models first."
            )

    print("Preparing deterministic held-out dataset (no retraining)...")
    print(f"Episodes per class: {EPISODES_PER_CLASS}")
    print(f"Forecast horizon: {FUTURE_HORIZON_MINUTES} minutes")
    print(f"Telemetry window: {WINDOW_SIZE} readings")

    _, x_test, _, y_test = prepare_dataset(
        random_seed=RANDOM_SEED,
        window_size=WINDOW_SIZE,
        future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        duration_minutes=EPISODE_DURATION_MINUTES,
        episodes_per_class=EPISODES_PER_CLASS,
    )
    actual = normalize_labels(y_test).to_numpy(dtype=str)

    anomaly_detector = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )
    anomaly_detector.load(ANOMALY_MODEL_PATH)

    classifier = FaultClassifier(random_state=RANDOM_SEED)
    classifier.load(CLASSIFIER_MODEL_PATH)

    features = x_test.copy()
    features["anomaly_score"] = anomaly_detector.anomaly_score(
        x_test.to_numpy(dtype=float)
    )

    expected = getattr(classifier.model, "n_features_in_", None)
    if expected is not None and expected != features.shape[1]:
        raise ValueError(
            f"Feature mismatch: saved classifier expects {expected}, "
            f"but regenerated dataset has {features.shape[1]} features."
        )

    probability_rows = classifier.predict_proba(features.to_numpy(dtype=float))
    classes = [str(name) for name in classifier.classes()]

    results = [
        evaluate_threshold(
            actual,
            predictions_for_threshold(probability_rows, classes, threshold),
            threshold,
        )
        for threshold in THRESHOLDS
    ]

    print("\nTHRESHOLD SWEEP (EVALUATION ONLY; NO FILES MODIFIED)")
    print("-" * 108)
    print(
        f"{'Threshold':>9} {'Accuracy':>10} {'Normal FPR':>12} {'False +':>9} "
        f"{'Missed':>8} {'Fault recall':>13} {'Cong. prec.':>12} {'Device prec.':>13} {'Macro F1':>10}"
    )
    for result in results:
        print(
            f"{result['threshold']:>9.2f} "
            f"{result['accuracy_percent']:>9.2f}% "
            f"{result['normal_false_positive_rate_percent']:>11.2f}% "
            f"{result['normal_false_positives']:>9} "
            f"{result['missed_future_faults']:>8} "
            f"{result['future_fault_recall_percent']:>12.2f}% "
            f"{result['congestion_precision_percent']:>11.2f}% "
            f"{result['device_failure_precision_percent']:>12.2f}% "
            f"{result['macro_f1_percent']:>9.2f}%"
        )

    print("\nConfusion matrices use rows=actual, columns=predicted; label order:")
    print(list(LABELS))
    for result in results:
        print(f"\nThreshold {result['threshold']:.2f}: {result['confusion_matrix']}")

    # Deliberately do not save results or change the production threshold.
    print("\nSaved model files, evaluation_results.json, and app settings were not modified.")


if __name__ == "__main__":
    main()
