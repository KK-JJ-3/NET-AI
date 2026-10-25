from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, f1_score

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.probability_calibration import load_calibration_temperature
from training.prepare import prepare_dataset
from training.train_models import (
    ANOMALY_CONTAMINATION,
    ANOMALY_MODEL_PATH,
    CLASSIFIER_MODEL_PATH,
    EPISODE_DURATION_MINUTES,
    EPISODES_PER_CLASS,
    FAULT_CLASSES,
    FUTURE_HORIZON_MINUTES,
    RANDOM_SEED,
    WINDOW_SIZE,
    normalize_labels,
)

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "models"
CALIBRATION_PATH = MODEL_DIR / "probability_calibration.json"
OUTPUT_PATH = MODEL_DIR / "risk_threshold_calibrated_multiseed.json"

THRESHOLDS = (0.40, 0.45, 0.50, 0.55, 0.60)
CALIBRATION_SEED = RANDOM_SEED + 1
TEST_SEEDS = (RANDOM_SEED + 2, RANDOM_SEED + 3, RANDOM_SEED + 4)


def summarize(
    threshold: float,
    actual: np.ndarray,
    probabilities: np.ndarray,
    class_indexes: dict[str, int],
) -> dict[str, Any]:
    normal_index = class_indexes["normal"]
    predicted = []

    for row in probabilities:
        risk = 1.0 - float(row[normal_index])
        if risk < threshold:
            predicted.append("normal")
        else:
            predicted.append(
                max(
                    FAULT_CLASSES,
                    key=lambda name: float(row[class_indexes[name]]),
                )
            )

    predicted_array = np.asarray(predicted, dtype=str)
    normal_mask = actual == "normal"
    fault_mask = ~normal_mask
    normal_count = int(normal_mask.sum())
    fault_count = int(fault_mask.sum())

    false_positives = int(
        np.sum(normal_mask & (predicted_array != "normal"))
    )
    missed_faults = int(
        np.sum(fault_mask & (predicted_array == "normal"))
    )

    return {
        "threshold": threshold,
        "accuracy_percent": round(
            float(accuracy_score(actual, predicted_array)) * 100, 2
        ),
        "macro_f1_percent": round(
            float(
                f1_score(
                    actual,
                    predicted_array,
                    labels=list(FAULT_CLASSES),
                    average="macro",
                    zero_division=0,
                )
            ) * 100,
            2,
        ),
        "normal_samples": normal_count,
        "normal_false_positives": false_positives,
        "normal_false_positive_rate_percent": round(
            false_positives / normal_count * 100, 2
        ) if normal_count else None,
        "future_fault_samples": fault_count,
        "missed_future_faults": missed_faults,
        "future_fault_miss_rate_percent": round(
            missed_faults / fault_count * 100, 2
        ) if fault_count else None,
    }


def main() -> None:
    for path in (
        ANOMALY_MODEL_PATH,
        CLASSIFIER_MODEL_PATH,
        CALIBRATION_PATH,
    ):
        if not path.exists():
            raise FileNotFoundError(f"Required artifact not found: {path}")

    temperature = load_calibration_temperature(
        CALIBRATION_PATH, CLASSIFIER_MODEL_PATH
    )
    calibration = json.loads(
        CALIBRATION_PATH.read_text(encoding="utf-8")
    )

    if calibration.get("calibration_seed") != CALIBRATION_SEED:
        raise ValueError("Unexpected calibration seed.")
    if calibration.get("forecast_horizon_minutes") != FUTURE_HORIZON_MINUTES:
        raise ValueError("Calibration horizon does not match configuration.")
    if calibration.get("window_size") != WINDOW_SIZE:
        raise ValueError("Calibration window size does not match configuration.")

    anomaly = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )
    anomaly.load(ANOMALY_MODEL_PATH)

    classifier = FaultClassifier(random_state=RANDOM_SEED)
    classifier.load(CLASSIFIER_MODEL_PATH)
    classifier.set_probability_temperature(temperature)

    classes = [str(name) for name in classifier.classes()]
    class_indexes = {name: index for index, name in enumerate(classes)}

    required = {"normal", "congestion", "device_failure"}
    if not required.issubset(class_indexes):
        raise ValueError(
            f"Classifier missing classes: {sorted(required - set(class_indexes))}"
        )

    if calibration.get("class_order") != classes:
        raise ValueError("Calibration class order does not match the classifier.")

    aggregate_labels: list[np.ndarray] = []
    aggregate_probabilities: list[np.ndarray] = []
    per_seed: dict[str, Any] = {}

    print("CALIBRATED PRODUCTION MODEL — MULTI-SEED THRESHOLD EVALUATION")
    print(f"Calibration temperature: {temperature:.6f}")
    print(f"Independent test seeds: {', '.join(map(str, TEST_SEEDS))}")
    print(f"Thresholds: {', '.join(f'{t:.2f}' for t in THRESHOLDS)}")
    print("No model retraining; no production threshold changes.")

    for seed in TEST_SEEDS:
        print(f"\nPreparing held-out episode split for seed {seed}...")

        _, x_test, _, y_test, _ = prepare_dataset(
            random_seed=seed,
            window_size=WINDOW_SIZE,
            future_horizon_minutes=FUTURE_HORIZON_MINUTES,
            duration_minutes=EPISODE_DURATION_MINUTES,
            episodes_per_class=EPISODES_PER_CLASS,
            return_baseline_mask=True,
        )

        actual = normalize_labels(y_test).to_numpy(dtype=str)
        base_features = x_test.to_numpy(dtype=float)
        model_features = np.column_stack(
            (base_features, anomaly.anomaly_score(base_features))
        )

        expected = getattr(classifier.model, "n_features_in_", None)
        if expected is not None and expected != model_features.shape[1]:
            raise ValueError(
                f"Feature mismatch: model expects {expected}, "
                f"dataset provides {model_features.shape[1]}."
            )

        probabilities = classifier.predict_proba(model_features)
        seed_results = [
            summarize(threshold, actual, probabilities, class_indexes)
            for threshold in THRESHOLDS
        ]

        per_seed[str(seed)] = {
            "test_samples": int(len(actual)),
            "results": seed_results,
        }
        aggregate_labels.append(actual)
        aggregate_probabilities.append(probabilities)

        print("Threshold  Accuracy  Macro-F1  Normal FPR  Fault miss rate")
        for row in seed_results:
            print(
                f"{row['threshold']:.2f}       "
                f"{row['accuracy_percent']:>6.2f}%   "
                f"{row['macro_f1_percent']:>6.2f}%   "
                f"{row['normal_false_positive_rate_percent']:>7.2f}%   "
                f"{row['future_fault_miss_rate_percent']:>7.2f}%"
            )

    combined_labels = np.concatenate(aggregate_labels)
    combined_probabilities = np.concatenate(aggregate_probabilities)

    aggregate_results = [
        summarize(
            threshold,
            combined_labels,
            combined_probabilities,
            class_indexes,
        )
        for threshold in THRESHOLDS
    ]

    report = {
        "task": "calibrated_saved_model_multiseed_threshold_evaluation",
        "evaluation_only": True,
        "production_threshold_changed": False,
        "model_artifacts_saved": False,
        "classifier": CLASSIFIER_MODEL_PATH.name,
        "anomaly_model": ANOMALY_MODEL_PATH.name,
        "calibration_temperature": temperature,
        "calibration_hash_validated": True,
        "calibration_seed": CALIBRATION_SEED,
        "test_seeds": list(TEST_SEEDS),
        "episode_grouped_splits": True,
        "forecast_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "thresholds": list(THRESHOLDS),
        "total_test_samples": int(len(combined_labels)),
        "per_seed": per_seed,
        "aggregate_results": aggregate_results,
        "decision_rule": (
            "risk=1-P(normal); risk<threshold => normal; "
            "otherwise highest-probability fault class"
        ),
        "synthetic_data_warning": (
            "Generated simulator episodes do not establish real-network performance."
        ),
    }

    OUTPUT_PATH.write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    print("\nAGGREGATE RESULTS ACROSS INDEPENDENT TEST SEEDS")
    print("Threshold  Accuracy  Macro-F1  Normal FPR  Fault miss rate")
    for row in aggregate_results:
        print(
            f"{row['threshold']:.2f}       "
            f"{row['accuracy_percent']:>6.2f}%   "
            f"{row['macro_f1_percent']:>6.2f}%   "
            f"{row['normal_false_positive_rate_percent']:>7.2f}%   "
            f"{row['future_fault_miss_rate_percent']:>7.2f}%"
        )

    print(f"\nNew report saved to: {OUTPUT_PATH}")
    print("Production threshold remains unchanged.")


if __name__ == "__main__":
    main()
