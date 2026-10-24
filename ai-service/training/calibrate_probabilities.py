from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import brier_score_loss

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.probability_calibration import (
    CALIBRATION_METHOD,
    fit_temperature,
    probabilities_from_logits,
    sha256_file,
)
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


MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
CALIBRATION_PATH = MODEL_DIR / "probability_calibration.json"
EVALUATION_PATH = MODEL_DIR / "probability_calibration_evaluation.json"
CALIBRATION_SEED = RANDOM_SEED + 1
TEST_SEEDS = (RANDOM_SEED + 2, RANDOM_SEED + 3, RANDOM_SEED + 4)
FAULT_RISK_THRESHOLD = 0.4


def _held_out_data(
    seed: int,
    anomaly_detector: AnomalyDetector,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate a separate episode-grouped holdout and append the anomaly feature."""
    _, x_test, _, y_test, _ = prepare_dataset(
        random_seed=seed,
        window_size=WINDOW_SIZE,
        future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        duration_minutes=EPISODE_DURATION_MINUTES,
        episodes_per_class=EPISODES_PER_CLASS,
        return_baseline_mask=True,
    )
    base_features = x_test.to_numpy(dtype=float)
    anomaly_scores = anomaly_detector.anomaly_score(base_features)
    features = np.column_stack((base_features, anomaly_scores))
    labels = normalize_labels(y_test).to_numpy(dtype=str)
    return features, labels


def _metrics(
    probabilities: np.ndarray,
    labels: np.ndarray,
    classes: list[str],
) -> dict[str, float | int]:
    class_indexes = {name: index for index, name in enumerate(classes)}
    target_indexes = np.asarray([class_indexes[label] for label in labels], dtype=int)
    selected = probabilities[np.arange(len(labels)), target_indexes]
    multiclass_log_loss = float(-np.mean(np.log(np.clip(selected, 1e-15, 1.0))))
    one_hot = np.zeros_like(probabilities)
    one_hot[np.arange(len(labels)), target_indexes] = 1.0
    multiclass_brier = float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1)))

    risk = np.clip(1.0 - probabilities[:, class_indexes["normal"]], 0.0, 1.0)
    binary_target = (labels != "normal").astype(int)
    risk_brier = float(brier_score_loss(binary_target, risk))
    risk_for_log = np.clip(risk, 1e-15, 1.0 - 1e-15)
    risk_log_loss = float(-np.mean(
        binary_target * np.log(risk_for_log)
        + (1 - binary_target) * np.log(1.0 - risk_for_log)
    ))
    warned = risk >= FAULT_RISK_THRESHOLD
    normal_mask = labels == "normal"
    fault_mask = ~normal_mask
    return {
        "samples": int(len(labels)),
        "risk_brier_score": risk_brier,
        "risk_log_loss": risk_log_loss,
        "multiclass_brier_score": multiclass_brier,
        "multiclass_log_loss": multiclass_log_loss,
        "normal_false_positive_rate": float(np.mean(warned[normal_mask])) if normal_mask.any() else 0.0,
        "fault_miss_rate": float(np.mean(~warned[fault_mask])) if fault_mask.any() else 0.0,
        "critical_share_of_warnings": float(np.mean(risk[warned] >= 0.8)) if warned.any() else 0.0,
        "risk_at_least_095_share_of_warnings": float(np.mean(risk[warned] >= 0.95)) if warned.any() else 0.0,
        "median_warning_risk": float(np.median(risk[warned])) if warned.any() else 0.0,
    }


def main() -> None:
    for path in (ANOMALY_MODEL_PATH, CLASSIFIER_MODEL_PATH):
        if not path.exists():
            raise FileNotFoundError(f"Required model artifact not found: {path}")

    anomaly_detector = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )
    anomaly_detector.load(ANOMALY_MODEL_PATH)
    classifier = FaultClassifier(random_state=RANDOM_SEED)
    classifier.load(CLASSIFIER_MODEL_PATH)
    classes = [str(name) for name in classifier.classes()]

    # Seed 43 is used only to fit temperature. Test seeds remain separate.
    calibration_features, calibration_labels = _held_out_data(
        CALIBRATION_SEED, anomaly_detector
    )
    calibration_logits = classifier.predict_logits(calibration_features)
    temperature = fit_temperature(calibration_logits, calibration_labels, classes)
    raw_calibration = probabilities_from_logits(calibration_logits, 1.0)
    scaled_calibration = probabilities_from_logits(calibration_logits, temperature)
    calibration_metrics = {
        "raw": _metrics(raw_calibration, calibration_labels, classes),
        "temperature_scaled": _metrics(scaled_calibration, calibration_labels, classes),
    }

    per_seed: dict[str, Any] = {}
    raw_probabilities: list[np.ndarray] = []
    scaled_probabilities: list[np.ndarray] = []
    all_labels: list[np.ndarray] = []
    for seed in TEST_SEEDS:
        features, labels = _held_out_data(seed, anomaly_detector)
        logits = classifier.predict_logits(features)
        raw = probabilities_from_logits(logits, 1.0)
        scaled = probabilities_from_logits(logits, temperature)
        per_seed[str(seed)] = {
            "raw": _metrics(raw, labels, classes),
            "temperature_scaled": _metrics(scaled, labels, classes),
        }
        raw_probabilities.append(raw)
        scaled_probabilities.append(scaled)
        all_labels.append(labels)

    combined_labels = np.concatenate(all_labels)
    raw_aggregate = _metrics(np.concatenate(raw_probabilities), combined_labels, classes)
    scaled_aggregate = _metrics(np.concatenate(scaled_probabilities), combined_labels, classes)
    improves_required_metrics = (
        scaled_aggregate["risk_brier_score"] < raw_aggregate["risk_brier_score"]
        and scaled_aggregate["risk_log_loss"] < raw_aggregate["risk_log_loss"]
        and scaled_aggregate["multiclass_log_loss"] < raw_aggregate["multiclass_log_loss"]
    )

    calibration_artifact = {
        "method": CALIBRATION_METHOD,
        "temperature": temperature,
        "classifier_sha256": sha256_file(CLASSIFIER_MODEL_PATH),
        "calibration_seed": CALIBRATION_SEED,
        "calibration_split": "episode-grouped held-out split",
        "calibration_samples": int(len(calibration_labels)),
        "forecast_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "class_order": classes,
    }
    evaluation_report = {
        "task": "xgboost_probability_temperature_calibration",
        "evaluation_only": True,
        "production_temperature": temperature,
        "calibration_seed": CALIBRATION_SEED,
        "test_seeds": list(TEST_SEEDS),
        "episode_grouped_splits": True,
        "forecast_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "window_size": WINDOW_SIZE,
        "calibration_metrics": calibration_metrics,
        "per_test_seed": per_seed,
        "aggregate_test_metrics": {
            "raw": raw_aggregate,
            "temperature_scaled": scaled_aggregate,
        },
        "accepted_for_production": improves_required_metrics,
        "synthetic_data_warning": "These results use generated simulator episodes and do not establish real-network calibration.",
    }
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    EVALUATION_PATH.write_text(json.dumps(evaluation_report, indent=2), encoding="utf-8")
    if not improves_required_metrics:
        raise RuntimeError(
            "Temperature scaling did not improve all required held-out scoring metrics; "
            f"no production calibration artifact was written. Inspect {EVALUATION_PATH}."
        )
    CALIBRATION_PATH.write_text(json.dumps(calibration_artifact, indent=2), encoding="utf-8")

    print("XGBOOST PROBABILITY CALIBRATION")
    print(f"Temperature fitted on episode-grouped calibration seed {CALIBRATION_SEED}: {temperature:.4f}")
    print(f"Independent test seeds: {', '.join(map(str, TEST_SEEDS))}")
    print("Aggregate held-out test metrics (lower is better for scoring metrics):")
    print("Metric                              Raw       Temperature-scaled")
    for key, label in (
        ("risk_brier_score", "Risk Brier score"),
        ("risk_log_loss", "Risk log loss"),
        ("multiclass_brier_score", "Multiclass Brier score"),
        ("multiclass_log_loss", "Multiclass log loss"),
        ("normal_false_positive_rate", "Normal false-positive rate"),
        ("fault_miss_rate", "Fault miss rate"),
        ("critical_share_of_warnings", "Critical share of warnings"),
        ("risk_at_least_095_share_of_warnings", "Warnings at risk >= 0.95"),
    ):
        raw_value = raw_aggregate[key]
        scaled_value = scaled_aggregate[key]
        if "rate" in key or "share" in key:
            print(f"{label:<35} {raw_value:>8.2%} {scaled_value:>20.2%}")
        else:
            print(f"{label:<35} {raw_value:>8.5f} {scaled_value:>20.5f}")
    print()
    print(f"Saved calibration artifact: {CALIBRATION_PATH}")
    print(f"Saved held-out evaluation: {EVALUATION_PATH}")


if __name__ == "__main__":
    main()
