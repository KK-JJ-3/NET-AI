from __future__ import annotations

"""Evaluate the saved future-fault model under controlled raw-telemetry noise.

This is an evaluation-only experiment. It does not retrain or save model
artifacts and does not modify the production risk threshold.

Run from the ai-service directory:
    python -m training.evaluate_noise_robustness
"""

import json
from pathlib import Path
from typing import Any

from numpy.lib.stride_tricks import sliding_window_view
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.probability_calibration import load_calibration_temperature
from training.fault_thresholds import find_fault_index
from training.prepare import (
    BASE_FEATURE_COLUMNS,
    FUTURE_HORIZON_MINUTES,
    build_training_features,
)
from training.train_models import (
    ANOMALY_CONTAMINATION,
    ANOMALY_MODEL_PATH,
    CLASSIFIER_MODEL_PATH,
    EPISODE_DURATION_MINUTES,
    FAULT_CLASSES,
    RANDOM_SEED,
    WINDOW_SIZE,
)
from simulator.dataset import generate_dataset

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "models"
CALIBRATION_PATH = MODEL_DIR / "probability_calibration.json"
OUTPUT_PATH = MODEL_DIR / "noise_robustness_evaluation.json"

# Independent test episodes use a smaller held-out synthetic sample so the
# five-level robustness sweep remains practical on a developer workstation.
TEST_SEEDS = (RANDOM_SEED + 2, RANDOM_SEED + 3, RANDOM_SEED + 4)
EVALUATION_EPISODES_PER_CLASS = 100
# Multipliers of the simulator's representative per-reading noise scale.
NOISE_LEVELS = (0.0, 0.25, 0.5, 1.0, 2.0)
NOISE_SIGMA = {
    "latency_ms": 4.0,
    "packet_loss_pct": 0.45,
    "jitter_ms": 1.8,
    "utilization_pct": 3.0,
    "cpu_pct": 3.0,
    "memory_pct": 2.0,
}
CONTINUOUS_FIELDS = tuple(NOISE_SIGMA)


def _clamp_telemetry(data: pd.DataFrame) -> None:
    """Keep perturbed telemetry within broad physically meaningful bounds."""
    bounds = {
        "latency_ms": (0.0, 5000.0),
        "packet_loss_pct": (0.0, 100.0),
        "jitter_ms": (0.0, 2000.0),
        "utilization_pct": (0.0, 100.0),
        "cpu_pct": (0.0, 100.0),
        "memory_pct": (0.0, 100.0),
    }
    for field, (lower, upper) in bounds.items():
        data[field] = data[field].clip(lower=lower, upper=upper)


def perturb_raw_telemetry(
    data: pd.DataFrame,
    noise_level: float,
    random_seed: int,
) -> pd.DataFrame:
    """Add reproducible Gaussian noise before rolling feature engineering.

    Labels, timestamps, episode IDs, and availability are deliberately kept
    unchanged. Availability is a state/indicator, not a continuous metric.
    """
    perturbed = data.copy(deep=True)
    if noise_level == 0.0:
        return perturbed

    rng = np.random.default_rng(random_seed)
    for field, sigma in NOISE_SIGMA.items():
        perturbation = rng.normal(
            loc=0.0,
            scale=sigma * noise_level,
            size=len(perturbed),
        )
        perturbed[field] = perturbed[field].to_numpy(dtype=float) + perturbation
    _clamp_telemetry(perturbed)
    return perturbed


def _selected_window_end_indices(
    clean_episode: pd.DataFrame,
    window_size: int,
    future_horizon_minutes: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Mirror prepare.build_training_features' clean-label window selection.

    Returning the clean selected endpoints lets each noise level use identical
    examples and labels even if noise would otherwise shift threshold-based
    fault-onset detection.
    """
    episode = clean_episode.sort_values("recorded_at").reset_index(drop=True)
    episode_length = len(episode)
    end_indices = np.arange(window_size - 1, episode_length)
    fault_type = _episode_fault_type(episode)
    fault_index = (
        find_fault_index(episode, fault_type)
        if fault_type in {"congestion", "device_failure"}
        else None
    )
    fault_time = (
        episode.iloc[fault_index]["recorded_at"]
        if fault_index is not None
        else None
    )
    keep_mask = np.ones(len(end_indices), dtype=bool)
    recovery_index = None
    if fault_index is not None:
        labels = episode["scenario_label"].astype(str).str.strip().str.lower()
        recovery_candidates = episode.index[
            (episode.index > fault_index)
            & (labels == "normal")
            & (episode["availability"].astype(float) > 0)
        ]
        if len(recovery_candidates):
            recovery_index = int(recovery_candidates[0])
        active_mask = end_indices >= fault_index
        if recovery_index is None:
            keep_mask &= ~active_mask
        else:
            keep_mask &= ~(active_mask & (end_indices < recovery_index))

    selected_end_indices = end_indices[keep_mask]
    target_labels = np.full(len(selected_end_indices), "normal", dtype=object)
    if fault_time is not None:
        current_times = episode.loc[selected_end_indices, "recorded_at"]
        time_to_fault = fault_time - current_times
        forecast_mask = (time_to_fault > pd.Timedelta(0)) & (
            time_to_fault <= pd.Timedelta(minutes=future_horizon_minutes)
        )
        target_labels[forecast_mask.to_numpy()] = fault_type
    return selected_end_indices, target_labels


def _episode_fault_type(episode: pd.DataFrame) -> str:
    labels = episode["scenario_label"].astype(str).str.strip().str.lower()
    for label in labels:
        if label in {"congestion", "device_failure"}:
            return label
    return "normal"


def _features_for_windows(
    noisy_episode: pd.DataFrame,
    end_indices: np.ndarray,
    window_size: int,
) -> pd.DataFrame:
    """Engineer 35 rolling features from perturbed raw telemetry windows."""
    episode = noisy_episode.sort_values("recorded_at").reset_index(drop=True)
    records: dict[str, np.ndarray] = {}
    positions = end_indices - window_size + 1
    x = np.arange(window_size, dtype=float)
    centered_x = x - x.mean()
    slope_denominator = float(np.dot(centered_x, centered_x))
    for field in BASE_FEATURE_COLUMNS:
        values = episode[field].to_numpy(dtype=float, copy=False)
        windows = sliding_window_view(values, window_size)[positions]
        records[f"{field}_current"] = windows[:, -1]
        records[f"{field}_mean"] = windows.mean(axis=1)
        records[f"{field}_max"] = windows.max(axis=1)
        records[f"{field}_std"] = windows.std(axis=1)
        records[f"{field}_slope"] = (
            (windows @ centered_x) / slope_denominator
            if window_size > 1 and slope_denominator != 0.0
            else np.zeros(len(windows), dtype=float)
        )
    return pd.DataFrame(records)


def _build_fixed_label_features(
    clean_data: pd.DataFrame,
    noisy_data: pd.DataFrame,
    clean_labels: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Create noisy features aligned to the clean dataset's labels/split rows."""
    if clean_labels is None:
        clean_labels = build_training_features(
            clean_data,
            window_size=WINDOW_SIZE,
            future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        )
    noisy_by_episode = {
        int(episode_id): group.sort_values("recorded_at").reset_index(drop=True)
        for episode_id, group in noisy_data.groupby("episode_id", sort=False)
    }
    clean_by_episode = {
        int(episode_id): group.sort_values("recorded_at").reset_index(drop=True)
        for episode_id, group in clean_data.groupby("episode_id", sort=False)
    }

    feature_parts: list[pd.DataFrame] = []
    label_parts: list[pd.Series] = []
    episode_parts: list[pd.Series] = []
    for episode_id, clean_episode in clean_by_episode.items():
        clean_feature_rows = clean_labels.loc[
            clean_labels["episode_id"] == episode_id
        ].reset_index(drop=True)
        if clean_feature_rows.empty:
            continue
        end_indices, target_labels = _selected_window_end_indices(
            clean_episode,
            WINDOW_SIZE,
            FUTURE_HORIZON_MINUTES,
        )
        if len(end_indices) != len(clean_feature_rows):
            raise ValueError(
                f"Clean window alignment failed for episode {episode_id}: "
                f"{len(end_indices)} endpoints vs {len(clean_feature_rows)} feature rows."
            )
        expected_labels = clean_feature_rows["target_label"].astype(str).to_numpy()
        if not np.array_equal(expected_labels, target_labels.astype(str)):
            raise ValueError(
                f"Clean target labels did not align for episode {episode_id}; "
                "refusing to evaluate mismatched examples."
            )
        noisy_features = _features_for_windows(
            noisy_by_episode[episode_id], end_indices, WINDOW_SIZE
        )
        feature_parts.append(noisy_features)
        label_parts.append(pd.Series(expected_labels, dtype=str))
        episode_parts.append(pd.Series([episode_id] * len(expected_labels), dtype=int))

    if not feature_parts:
        raise ValueError("No evaluation windows were generated.")
    features = pd.concat(feature_parts, ignore_index=True)
    labels = pd.concat(label_parts, ignore_index=True)
    episode_ids = pd.concat(episode_parts, ignore_index=True)
    return features, labels, episode_ids


def _split_episode_ids(episode_ids: pd.Series, seed: int) -> set[int]:
    unique_ids = episode_ids.drop_duplicates().to_numpy()
    rng = np.random.default_rng(seed)
    shuffled = rng.permutation(unique_ids)
    test_count = max(1, int(len(shuffled) * 0.2))
    return {int(value) for value in shuffled[:test_count]}


def _summarize(
    actual: np.ndarray,
    probabilities: np.ndarray,
    class_indexes: dict[str, int],
) -> dict[str, Any]:
    normal_index = class_indexes["normal"]
    predicted: list[str] = []
    for row in probabilities:
        risk = 1.0 - float(row[normal_index])
        if risk < 0.40:
            predicted.append("normal")
        else:
            predicted.append(
                max(FAULT_CLASSES, key=lambda name: float(row[class_indexes[name]]))
            )
    predicted_array = np.asarray(predicted, dtype=str)
    normal_mask = actual == "normal"
    fault_mask = ~normal_mask
    normal_count = int(normal_mask.sum())
    fault_count = int(fault_mask.sum())
    false_positives = int(np.sum(normal_mask & (predicted_array != "normal")))
    missed_faults = int(np.sum(fault_mask & (predicted_array == "normal")))
    return {
        "test_samples": int(len(actual)),
        "accuracy_percent": round(float(accuracy_score(actual, predicted_array)) * 100, 2),
        "macro_f1_percent": round(float(f1_score(actual, predicted_array, labels=list(FAULT_CLASSES), average="macro", zero_division=0)) * 100, 2),
        "normal_samples": normal_count,
        "normal_false_positives": false_positives,
        "normal_false_positive_rate_percent": round(false_positives / normal_count * 100, 2) if normal_count else None,
        "future_fault_samples": fault_count,
        "missed_future_faults": missed_faults,
        "future_fault_miss_rate_percent": round(missed_faults / fault_count * 100, 2) if fault_count else None,
    }


def main() -> None:
    for path in (ANOMALY_MODEL_PATH, CLASSIFIER_MODEL_PATH, CALIBRATION_PATH):
        if not path.exists():
            raise FileNotFoundError(f"Required model/calibration artifact not found: {path}")

    temperature = load_calibration_temperature(CALIBRATION_PATH, CLASSIFIER_MODEL_PATH)
    calibration = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    if calibration.get("forecast_horizon_minutes") != FUTURE_HORIZON_MINUTES:
        raise ValueError("Calibration horizon does not match current forecast configuration.")
    if calibration.get("window_size") != WINDOW_SIZE:
        raise ValueError("Calibration window size does not match current configuration.")

    anomaly = AnomalyDetector(contamination=ANOMALY_CONTAMINATION, random_state=RANDOM_SEED)
    anomaly.load(ANOMALY_MODEL_PATH)
    classifier = FaultClassifier(random_state=RANDOM_SEED)
    classifier.load(CLASSIFIER_MODEL_PATH)
    classifier.set_probability_temperature(temperature)
    classes = [str(name) for name in classifier.classes()]
    class_indexes = {name: index for index, name in enumerate(classes)}
    required = set(FAULT_CLASSES)
    if not required.issubset(class_indexes):
        raise ValueError(f"Classifier missing classes: {sorted(required - set(class_indexes))}")
    if calibration.get("class_order") != classes:
        raise ValueError("Calibration class order does not match the classifier.")

    aggregate: dict[str, list[np.ndarray]] = {
        str(level): [] for level in NOISE_LEVELS
    }
    aggregate_labels: list[np.ndarray] = []
    per_seed: dict[str, Any] = {}

    print("SAVED MODEL — RAW TELEMETRY NOISE ROBUSTNESS EVALUATION")
    print(f"Calibration temperature: {temperature:.6f}")
    print(f"Test seeds: {', '.join(map(str, TEST_SEEDS))}")
    print(f"Noise multipliers: {', '.join(map(str, NOISE_LEVELS))}")
    print("Evaluation only; production threshold remains 0.40.")

    for seed in TEST_SEEDS:
        print(f"\nGenerating fixed synthetic episodes for seed {seed}...")
        clean_data = generate_dataset(
            episodes_per_class=EVALUATION_EPISODES_PER_CLASS,
            duration_minutes=EPISODE_DURATION_MINUTES,
            random_seed=seed,
        )
        clean_labels = build_training_features(
            clean_data,
            window_size=WINDOW_SIZE,
            future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        )
        seed_split = _split_episode_ids(clean_labels["episode_id"], seed)
        seed_results: dict[str, Any] = {}

        for level in NOISE_LEVELS:
            noisy_data = perturb_raw_telemetry(
                clean_data,
                noise_level=level,
                random_seed=seed * 1000 + int(level * 100),
            )
            features, labels, episode_ids = _build_fixed_label_features(
                clean_data, noisy_data, clean_labels=clean_labels
            )
            test_mask = episode_ids.isin(seed_split).to_numpy()
            x_test = features.loc[test_mask].reset_index(drop=True)
            actual = labels.loc[test_mask].to_numpy(dtype=str)
            base_features = x_test.to_numpy(dtype=float)
            model_features = np.column_stack((base_features, anomaly.anomaly_score(base_features)))
            probabilities = classifier.predict_proba(model_features)
            result = _summarize(actual, probabilities, class_indexes)
            seed_results[str(level)] = result
            aggregate[str(level)].append(probabilities)
            if level == 0.0:
                aggregate_labels.append(actual)
            print(
                f"  noise x{level:<4} accuracy={result['accuracy_percent']:.2f}% "
                f"macro-F1={result['macro_f1_percent']:.2f}% "
                f"normal-FPR={result['normal_false_positive_rate_percent']}% "
                f"fault-miss={result['future_fault_miss_rate_percent']}%"
            )

        per_seed[str(seed)] = {
            "test_samples": int(seed_results[str(NOISE_LEVELS[0])]["test_samples"]),
            "results_by_noise_multiplier": seed_results,
        }

    # Each noise level is evaluated on the same per-seed examples in the same order.
    aggregate_results: dict[str, Any] = {}
    for level in NOISE_LEVELS:
        combined_probs = np.concatenate(aggregate[str(level)], axis=0)
        combined_actual = np.concatenate(aggregate_labels, axis=0)
        aggregate_results[str(level)] = _summarize(combined_actual, combined_probs, class_indexes)

    report = {
        "task": "saved_model_raw_telemetry_noise_robustness",
        "evaluation_only": True,
        "production_threshold_changed": False,
        "model_artifacts_saved": False,
        "classifier": CLASSIFIER_MODEL_PATH.name,
        "anomaly_model": ANOMALY_MODEL_PATH.name,
        "calibration_temperature": temperature,
        "calibration_hash_validated": True,
        "production_risk_threshold": 0.40,
        "test_seeds": list(TEST_SEEDS),
        "episodes_per_class": EVALUATION_EPISODES_PER_CLASS,
        "episode_duration_minutes": EPISODE_DURATION_MINUTES,
        "window_size": WINDOW_SIZE,
        "future_horizon_minutes": FUTURE_HORIZON_MINUTES,
        "noise_multipliers": list(NOISE_LEVELS),
        "raw_noise_sigma_by_field": NOISE_SIGMA,
        "noise_method": "independent seeded Gaussian perturbation before rolling feature engineering; clipped to broad metric bounds",
        "unchanged_during_perturbation": ["scenario_label", "recorded_at", "episode_id", "availability"],
        "same_clean_selected_windows_and_labels_across_noise_levels": True,
        "episode_grouped_splits": True,
        "per_seed": per_seed,
        "aggregate_results": aggregate_results,
        "decision_rule": "risk=1-P(normal); risk<0.40 => normal; otherwise highest-probability fault class",
        "synthetic_data_warning": "Generated simulator episodes do not establish real-network performance. Noise magnitudes are controlled stress-test assumptions, not measured field noise.",
    }
    OUTPUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nNew report saved to: {OUTPUT_PATH}")
    print("Production threshold remains unchanged; no model artifacts were saved.")


if __name__ == "__main__":
    main()
