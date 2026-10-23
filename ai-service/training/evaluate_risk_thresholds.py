from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from training.prepare import prepare_dataset
from training.train_models import (
    ANOMALY_CONTAMINATION,
    CLASSIFIER_ESTIMATORS,
    CLASSIFIER_MAX_DEPTH,
    EPISODE_DURATION_MINUTES,
    EPISODES_PER_CLASS,
    FAULT_CLASSES,
    FUTURE_HORIZON_MINUTES,
    RANDOM_SEED,
    WINDOW_SIZE,
    normalize_labels,
    validate_dataset,
)

PROJECT_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_DIR / "models"
OUTPUT_PATH = MODEL_DIR / "risk_threshold_sweep.json"
THRESHOLDS = (0.40, 0.45, 0.50, 0.55, 0.60)


def predict_at_thresholds(
    probabilities: np.ndarray,
    classes: list[str],
    thresholds: tuple[float, ...],
) -> dict[float, np.ndarray]:
    """Apply the production decision rule without mutating its threshold."""
    class_index = {name: index for index, name in enumerate(classes)}
    required = set(FAULT_CLASSES)
    if not required.issubset(class_index):
        raise ValueError(f"Classifier missing classes: {sorted(required - set(class_index))}")
    if "normal" not in class_index:
        raise ValueError("Classifier is missing the normal class")

    results: dict[float, np.ndarray] = {}
    for threshold in thresholds:
        predicted: list[str] = []
        for row in probabilities:
            p_normal = float(row[class_index["normal"]])
            risk = 1.0 - p_normal
            if risk < threshold:
                predicted.append("normal")
            else:
                predicted.append(max(
                    ("congestion", "device_failure"),
                    key=lambda label: float(row[class_index[label]]),
                ))
        results[threshold] = np.asarray(predicted, dtype=str)
    return results


def summarize_threshold(
    threshold: float,
    actual: np.ndarray,
    predicted: np.ndarray,
) -> dict[str, Any]:
    labels = list(FAULT_CLASSES)
    matrix = confusion_matrix(actual, predicted, labels=labels)
    report = classification_report(
        actual, predicted, labels=labels, output_dict=True, zero_division=0
    )
    normal_mask = actual == "normal"
    fault_mask = ~normal_mask
    normal_count = int(normal_mask.sum())
    fault_count = int(fault_mask.sum())
    normal_fp = int(np.sum(normal_mask & (predicted != "normal")))
    missed_faults = int(np.sum(fault_mask & (predicted == "normal")))
    return {
        "threshold": threshold,
        "accuracy_percent": round(float(accuracy_score(actual, predicted)) * 100, 2),
        "macro_f1_percent": round(float(f1_score(actual, predicted, labels=labels, average="macro", zero_division=0)) * 100, 2),
        "normal_samples": normal_count,
        "normal_false_positives": normal_fp,
        "normal_false_positive_rate_percent": round(normal_fp / normal_count * 100, 2) if normal_count else None,
        "future_fault_samples": fault_count,
        "missed_future_faults": missed_faults,
        "future_fault_miss_rate_percent": round(missed_faults / fault_count * 100, 2) if fault_count else None,
        "classification_report": report,
        "confusion_matrix": {"labels": labels, "matrix": matrix.tolist()},
    }


def main() -> None:
    print("RISK THRESHOLD SWEEP (EVALUATION ONLY)")
    print("Production threshold is not changed; model files are not saved or overwritten.")
    print(f"Thresholds: {', '.join(f'{t:.2f}' for t in THRESHOLDS)}")
    print(f"Forecast horizon: {FUTURE_HORIZON_MINUTES} minutes; seed: {RANDOM_SEED}")

    x_train, x_test, y_train, y_test, _baseline_mask = prepare_dataset(
        random_seed=RANDOM_SEED,
        window_size=WINDOW_SIZE,
        future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        duration_minutes=EPISODE_DURATION_MINUTES,
        episodes_per_class=EPISODES_PER_CLASS,
        return_baseline_mask=True,
    )
    y_train = normalize_labels(y_train)
    y_test = normalize_labels(y_test)
    validate_dataset(x_train, x_test, y_train, y_test)

    x_train_np = x_train.to_numpy(dtype=float)
    x_test_np = x_test.to_numpy(dtype=float)
    anomaly = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )
    anomaly.fit(x_train_np)

    x_train_model = x_train.copy()
    x_test_model = x_test.copy()
    x_train_model["anomaly_score"] = anomaly.anomaly_score(x_train_np)
    x_test_model["anomaly_score"] = anomaly.anomaly_score(x_test_np)

    classifier = FaultClassifier(
        n_estimators=CLASSIFIER_ESTIMATORS,
        max_depth=CLASSIFIER_MAX_DEPTH,
        random_state=RANDOM_SEED,
    )
    classifier.fit(x_train_model.to_numpy(dtype=float), y_train.to_numpy())

    probability_rows = classifier.predict_proba(x_test_model.to_numpy(dtype=float))
    classes = [str(name) for name in classifier.classes()]
    predictions = predict_at_thresholds(probability_rows, classes, THRESHOLDS)
    actual = y_test.to_numpy(dtype=str)
    results = [summarize_threshold(t, actual, predictions[t]) for t in THRESHOLDS]

    print("\nSUMMARY")
    print("Threshold  Accuracy  Macro-F1  Normal FP  Normal FPR  Missed faults  Fault miss rate")
    for row in results:
        print(
            f"{row['threshold']:.2f}       "
            f"{row['accuracy_percent']:>6.2f}%   "
            f"{row['macro_f1_percent']:>6.2f}%   "
            f"{row['normal_false_positives']:>7}   "
            f"{row['normal_false_positive_rate_percent']:>7.2f}%   "
            f"{row['missed_future_faults']:>7}        "
            f"{row['future_fault_miss_rate_percent']:>7.2f}%"
        )

    report = {
        "task": "risk_threshold_sweep",
        "evaluation_only": True,
        "production_threshold_changed": False,
        "model_artifacts_saved": False,
        "decision_rule": "risk=1-P(normal); risk<threshold => normal; otherwise highest-probability fault class",
        "thresholds": list(THRESHOLDS),
        "random_seed": RANDOM_SEED,
        "episodes_per_class": EPISODES_PER_CLASS,
        "future_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "test_samples": int(len(x_test_model)),
        "results": results,
    }
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nFull report saved to: {OUTPUT_PATH}")
    print("This is a fresh in-memory reproduction of the configured train/test split, not a change to production settings.")


if __name__ == "__main__":
    main()
