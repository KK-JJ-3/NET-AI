from __future__ import annotations

import json
from pathlib import Path

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
OUTPUT_PATH = MODEL_DIR / "risk_threshold_calibrated_evaluation.json"
THRESHOLDS = (0.40, 0.45, 0.50, 0.55, 0.60)


def main() -> None:
    for path in (ANOMALY_MODEL_PATH, CLASSIFIER_MODEL_PATH, CALIBRATION_PATH):
        if not path.exists():
            raise FileNotFoundError(f"Required artifact not found: {path}")

    temperature = load_calibration_temperature(
        CALIBRATION_PATH, CLASSIFIER_MODEL_PATH
    )

    calibration = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    if calibration.get("forecast_horizon_minutes") != FUTURE_HORIZON_MINUTES:
        raise ValueError("Calibration horizon does not match the configured horizon.")
    if calibration.get("window_size") != WINDOW_SIZE:
        raise ValueError("Calibration window size does not match configuration.")

    print("Preparing held-out dataset...")
    _, x_test, _, y_test = prepare_dataset(
        random_seed=RANDOM_SEED,
        window_size=WINDOW_SIZE,
        future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        duration_minutes=EPISODE_DURATION_MINUTES,
        episodes_per_class=EPISODES_PER_CLASS,
    )
    y_test = normalize_labels(y_test).to_numpy(dtype=str)

    anomaly = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )
    anomaly.load(ANOMALY_MODEL_PATH)

    classifier = FaultClassifier(random_state=RANDOM_SEED)
    classifier.load(CLASSIFIER_MODEL_PATH)
    classifier.set_probability_temperature(temperature)

    features = x_test.to_numpy(dtype=float)
    model_features = x_test.copy()
    model_features["anomaly_score"] = anomaly.anomaly_score(features)

    expected = getattr(classifier.model, "n_features_in_", None)
    if expected is not None and expected != model_features.shape[1]:
        raise ValueError(
            f"Feature mismatch: model expects {expected}, "
            f"dataset provides {model_features.shape[1]}."
        )

    probabilities = classifier.predict_proba(
        model_features.to_numpy(dtype=float)
    )
    classes = [str(value) for value in classifier.classes()]
    indexes = {name: index for index, name in enumerate(classes)}

    required = {"normal", "congestion", "device_failure"}
    if not required.issubset(indexes):
        raise ValueError(f"Missing classifier classes: {sorted(required - set(indexes))}")

    results = []
    for threshold in THRESHOLDS:
        predicted = []
        for row in probabilities:
            risk = 1.0 - float(row[indexes["normal"]])
            if risk < threshold:
                predicted.append("normal")
            else:
                predicted.append(
                    max(
                        FAULT_CLASSES,
                        key=lambda name: float(row[indexes[name]]),
                    )
                )

        predicted = np.asarray(predicted, dtype=str)
        normal_mask = y_test == "normal"
        fault_mask = ~normal_mask
        false_positives = int(np.sum(normal_mask & (predicted != "normal")))
        missed_faults = int(np.sum(fault_mask & (predicted == "normal")))
        normal_count = int(normal_mask.sum())
        fault_count = int(fault_mask.sum())

        results.append({
            "threshold": threshold,
            "accuracy_percent": round(
                float(accuracy_score(y_test, predicted)) * 100, 2
            ),
            "macro_f1_percent": round(
                float(f1_score(
                    y_test,
                    predicted,
                    labels=list(FAULT_CLASSES),
                    average="macro",
                    zero_division=0,
                )) * 100, 2
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
        })

    report = {
        "task": "calibrated_production_model_threshold_evaluation",
        "evaluation_only": True,
        "production_threshold_changed": False,
        "model_artifacts_saved": False,
        "classifier": str(CLASSIFIER_MODEL_PATH.name),
        "calibration_temperature": temperature,
        "calibration_hash_validated": True,
        "random_seed": RANDOM_SEED,
        "forecast_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "test_samples": int(len(y_test)),
        "decision_rule": "risk=1-P(normal); risk<threshold => normal; otherwise highest-probability fault class",
        "thresholds": results,
        "synthetic_data_warning": (
            "Generated simulator episodes do not establish real-network performance."
        ),
    }

    OUTPUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nCalibration temperature: {temperature:.6f}")
    print(f"Test samples: {len(y_test)}")
    print("Threshold  Accuracy  Macro-F1  Normal FPR  Fault miss rate")
    for row in results:
        print(
            f"{row['threshold']:.2f}       "
            f"{row['accuracy_percent']:>6.2f}%   "
            f"{row['macro_f1_percent']:>6.2f}%   "
            f"{row['normal_false_positive_rate_percent']:>7.2f}%   "
            f"{row['future_fault_miss_rate_percent']:>7.2f}%"
        )
    print(f"\nNew report saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
