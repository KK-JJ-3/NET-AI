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
OUTPUT_PATH = MODEL_DIR / "risk_threshold_multiseed.json"

# Same candidates as the single-seed sweep. These are evaluation-only.
THRESHOLDS = (0.40, 0.45, 0.50, 0.55, 0.60)
# Include the configured seed plus two independent deterministic replications.
SEEDS = (RANDOM_SEED, RANDOM_SEED + 1, RANDOM_SEED + 2)


def predict_at_threshold(
    probabilities: np.ndarray,
    classes: list[str],
    threshold: float,
) -> np.ndarray:
    """Apply the app's risk decision rule at a candidate threshold."""
    class_index = {name: index for index, name in enumerate(classes)}
    required = {"normal", "congestion", "device_failure"}
    missing = required - set(class_index)
    if missing:
        raise ValueError(f"Classifier missing classes: {sorted(missing)}")

    predicted: list[str] = []
    for row in probabilities:
        risk = 1.0 - float(row[class_index["normal"]])
        if risk < threshold:
            predicted.append("normal")
        else:
            predicted.append(
                max(
                    ("congestion", "device_failure"),
                    key=lambda label: float(row[class_index[label]]),
                )
            )
    return np.asarray(predicted, dtype=str)


def summarize(
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
        "threshold": float(threshold),
        "accuracy_percent": round(float(accuracy_score(actual, predicted)) * 100, 2),
        "macro_f1_percent": round(
            float(f1_score(actual, predicted, labels=labels, average="macro", zero_division=0)) * 100,
            2,
        ),
        "normal_samples": normal_count,
        "normal_false_positives": normal_fp,
        "normal_false_positive_rate_percent": round(normal_fp / normal_count * 100, 2) if normal_count else None,
        "future_fault_samples": fault_count,
        "missed_future_faults": missed_faults,
        "future_fault_miss_rate_percent": round(missed_faults / fault_count * 100, 2) if fault_count else None,
        "classification_report": report,
        "confusion_matrix": {"labels": labels, "matrix": matrix.tolist()},
    }


def evaluate_seed(seed: int) -> tuple[dict[float, dict[str, Any]], dict[float, tuple[np.ndarray, np.ndarray]], int]:
    x_train, x_test, y_train, y_test, _baseline_mask = prepare_dataset(
        random_seed=seed,
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
        random_state=seed,
    )
    anomaly.fit(x_train_np)

    x_train_model = x_train.copy()
    x_test_model = x_test.copy()
    x_train_model["anomaly_score"] = anomaly.anomaly_score(x_train_np)
    x_test_model["anomaly_score"] = anomaly.anomaly_score(x_test_np)

    classifier = FaultClassifier(
        n_estimators=CLASSIFIER_ESTIMATORS,
        max_depth=CLASSIFIER_MAX_DEPTH,
        random_state=seed,
    )
    classifier.fit(x_train_model.to_numpy(dtype=float), y_train.to_numpy())

    probability_rows = classifier.predict_proba(x_test_model.to_numpy(dtype=float))
    classes = [str(name) for name in classifier.classes()]
    actual = y_test.to_numpy(dtype=str)

    summaries: dict[float, dict[str, Any]] = {}
    raw: dict[float, tuple[np.ndarray, np.ndarray]] = {}
    for threshold in THRESHOLDS:
        predicted = predict_at_threshold(probability_rows, classes, threshold)
        summaries[threshold] = summarize(threshold, actual, predicted)
        raw[threshold] = (actual, predicted)
    return summaries, raw, len(x_test_model)


def main() -> None:
    print("RISK THRESHOLD MULTI-SEED VALIDATION (EVALUATION ONLY)")
    print("Production threshold remains unchanged; no model artifacts are saved.")
    print(f"Thresholds: {', '.join(f'{t:.2f}' for t in THRESHOLDS)}")
    print(f"Seeds: {', '.join(str(s) for s in SEEDS)}")
    print(f"Forecast horizon: {FUTURE_HORIZON_MINUTES} minutes")
    print("Each seed trains temporary models in memory and evaluates its own held-out episode split.")

    per_seed: dict[str, Any] = {}
    aggregate_actual: dict[float, list[np.ndarray]] = {t: [] for t in THRESHOLDS}
    aggregate_predicted: dict[float, list[np.ndarray]] = {t: [] for t in THRESHOLDS}
    total_test_samples = 0

    for seed in SEEDS:
        print(f"\nRunning seed {seed}...")
        summaries, raw, test_count = evaluate_seed(seed)
        total_test_samples += test_count
        per_seed[str(seed)] = {
            "test_samples": test_count,
            "results": [summaries[t] for t in THRESHOLDS],
        }
        for threshold in THRESHOLDS:
            actual, predicted = raw[threshold]
            aggregate_actual[threshold].append(actual)
            aggregate_predicted[threshold].append(predicted)

        print("Threshold  Accuracy  Macro-F1  Normal FP  Normal FPR  Missed faults  Fault miss rate")
        for threshold in THRESHOLDS:
            row = summaries[threshold]
            print(
                f"{threshold:.2f}       {row['accuracy_percent']:>6.2f}%   "
                f"{row['macro_f1_percent']:>6.2f}%   "
                f"{row['normal_false_positives']:>7}   "
                f"{row['normal_false_positive_rate_percent']:>7.2f}%   "
                f"{row['missed_future_faults']:>7}        "
                f"{row['future_fault_miss_rate_percent']:>7.2f}%"
            )

    aggregate_results = []
    for threshold in THRESHOLDS:
        actual = np.concatenate(aggregate_actual[threshold])
        predicted = np.concatenate(aggregate_predicted[threshold])
        aggregate_results.append(summarize(threshold, actual, predicted))

    print("\nAGGREGATE RESULTS ACROSS SEEDS")
    print("Threshold  Accuracy  Macro-F1  Normal FP  Normal FPR  Missed faults  Fault miss rate")
    for row in aggregate_results:
        print(
            f"{row['threshold']:.2f}       {row['accuracy_percent']:>6.2f}%   "
            f"{row['macro_f1_percent']:>6.2f}%   "
            f"{row['normal_false_positives']:>7}   "
            f"{row['normal_false_positive_rate_percent']:>7.2f}%   "
            f"{row['missed_future_faults']:>7}        "
            f"{row['future_fault_miss_rate_percent']:>7.2f}%"
        )

    report = {
        "task": "risk_threshold_multiseed_validation",
        "evaluation_only": True,
        "production_threshold_changed": False,
        "model_artifacts_saved": False,
        "decision_rule": "risk=1-P(normal); risk<threshold => normal; otherwise highest-probability fault class",
        "thresholds": list(THRESHOLDS),
        "seeds": list(SEEDS),
        "episodes_per_class": EPISODES_PER_CLASS,
        "future_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "total_test_samples_across_seeds": total_test_samples,
        "per_seed": per_seed,
        "aggregate_results": aggregate_results,
    }
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nFull report saved to: {OUTPUT_PATH}")
    print("No production settings or trained model artifacts were modified.")


if __name__ == "__main__":
    main()
