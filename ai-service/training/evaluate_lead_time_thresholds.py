from __future__ import annotations

from app.forecast_config import FORECAST_HORIZON_MINUTES as SHARED_FORECAST_HORIZON_MINUTES

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.features import build_features
from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.schemas import TelemetryPoint
from simulator.dataset import generate_dataset
from simulator.scenarios import ScenarioConfig, ScenarioLabel, generate_scenario
from training.fault_thresholds import find_fault_index

# This is an evaluation-only threshold comparison. It does not edit app settings.
THRESHOLDS = (0.60, 0.70)
LABELS = ("normal", "congestion", "device_failure")
FAULT_LABELS = ("congestion", "device_failure")

PROJECT_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_DIR / "models"
ANOMALY_MODEL_PATH = MODEL_DIR / "isolation_forest.joblib"
CLASSIFIER_MODEL_PATH = MODEL_DIR / "xgboost_classifier.joblib"
OUTPUT_PATH = MODEL_DIR / "lead_time_threshold_comparison.json"

EPISODES_PER_CLASS = 5
DURATION_MINUTES = 60
RECOVERY_MINUTES = 20
WINDOW_SIZE = 15
RANDOM_SEED = 20261017
INTERVAL_SECONDS = 60
FORECAST_HORIZON_MINUTES = SHARED_FORECAST_HORIZON_MINUTES
CONGESTION_UTILIZATION_THRESHOLD = 90.0
CONGESTION_LATENCY_THRESHOLD = 100.0


def append_healthy_recovery(episode: pd.DataFrame, episode_id: int) -> pd.DataFrame:
    """Append a steady-normal tail to measure warnings during recovery."""
    last_time = episode["recorded_at"].iloc[-1]
    start_time = last_time + timedelta(seconds=INTERVAL_SECONDS)
    samples = generate_scenario(
        config=ScenarioConfig(
            label=ScenarioLabel.NORMAL,
            duration_minutes=RECOVERY_MINUTES - 1,
            interval_seconds=INTERVAL_SECONDS,
            pattern="gradual",
        ),
        start_time=start_time,
    )
    rows = [
        {
            "episode_id": episode_id,
            "recorded_at": sample.recorded_at,
            "latency_ms": sample.latency_ms,
            "packet_loss_pct": sample.packet_loss_pct,
            "jitter_ms": sample.jitter_ms,
            "utilization_pct": sample.utilization_pct,
            "cpu_pct": sample.cpu_pct,
            "memory_pct": sample.memory_pct,
            "availability": sample.availability,
            "scenario_label": sample.scenario_label.value,
        }
        for sample in samples
    ]
    return pd.concat([episode, pd.DataFrame(rows)], ignore_index=True)


def to_points(window: pd.DataFrame) -> list[TelemetryPoint]:
    points: list[TelemetryPoint] = []
    for row in window.to_dict("records"):
        points.append(
            TelemetryPoint(
                recorded_at=row["recorded_at"],
                latency_ms=float(row["latency_ms"]),
                packet_loss_pct=float(row["packet_loss_pct"]),
                jitter_ms=float(row["jitter_ms"]),
                utilization_pct=float(row["utilization_pct"]),
                cpu_pct=float(row["cpu_pct"]),
                memory_pct=float(row["memory_pct"]),
                availability=float(row["availability"]),
            )
        )
    return sorted(points, key=lambda point: point.recorded_at)


def predict_window(
    window: pd.DataFrame,
    anomaly_detector: AnomalyDetector,
    classifier: FaultClassifier,
) -> dict[str, Any]:
    """Run the same active-fault rules and saved models as FaultPredictor.

    The only variable is the threshold applied later to classifier risk.
    Active-fault detections deliberately remain independent of that threshold.
    """
    points = to_points(window)
    latest = points[-1]

    # Match app/predictor.py: active device failure takes precedence.
    if len(points) >= 2 and all(point.availability == 0 for point in points[-2:]):
        return {
            "active": True,
            "risk": 1.0,
            "best_fault_type": "device_failure",
            "source": "active_device_failure",
        }

    active_congestion = (
        latest.availability is not None
        and latest.availability > 0
        and latest.utilization_pct is not None
        and latest.latency_ms is not None
        and latest.utilization_pct >= CONGESTION_UTILIZATION_THRESHOLD
        and latest.latency_ms >= CONGESTION_LATENCY_THRESHOLD
    )
    if active_congestion:
        return {
            "active": True,
            "risk": 1.0,
            "best_fault_type": "congestion",
            "source": "active_congestion",
        }

    feature_dict = build_features(points)
    feature_array = np.asarray(list(feature_dict.values()), dtype=float).reshape(1, -1)
    anomaly_score = float(anomaly_detector.anomaly_score(feature_array)[0])
    classifier_input = np.concatenate(
        [feature_array, np.asarray([[anomaly_score]], dtype=float)],
        axis=1,
    )
    probabilities_array = classifier.predict_proba(classifier_input)[0]
    classes = [str(value) for value in classifier.classes()]
    probabilities = {name: float(probabilities_array[i]) for i, name in enumerate(classes)}

    missing = set(LABELS) - set(probabilities)
    if missing:
        raise ValueError(f"Saved classifier is missing classes: {sorted(missing)}")

    risk = 1.0 - probabilities["normal"]
    best_fault_type = max(FAULT_LABELS, key=lambda name: probabilities[name])
    return {
        "active": False,
        "risk": risk,
        "best_fault_type": best_fault_type,
        "source": "classifier_forecast",
    }


def rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def score_threshold(
    threshold: float,
    episode_predictions: list[dict[str, Any]],
) -> dict[str, Any]:
    total_windows = 0
    active_detection_windows = 0
    normal_windows = 0
    normal_warning_windows = 0
    recovery_windows = 0
    recovery_warning_windows = 0
    valid_forecast_windows = 0
    out_of_horizon_warning_windows = 0
    wrong_class_warning_windows = 0
    transition_warning_windows = 0
    warning_windows_during_fault = 0
    episode_results: list[dict[str, Any]] = []

    horizon_steps = max(1, int(FORECAST_HORIZON_MINUTES * 60 // INTERVAL_SECONDS))

    for episode_data in episode_predictions:
        episode_id = episode_data["episode_id"]
        scenario = episode_data["scenario"]
        onset = episode_data["onset"]
        recovery_index = episode_data["recovery_index"]
        window_predictions = episode_data["window_predictions"]

        valid_hits: list[int] = []
        out_of_horizon_hits: list[int] = []
        out_of_horizon = 0
        wrong_class = 0
        recovery_warnings = 0
        normal_episode_warnings = 0
        transition_warnings = 0
        fault_period_warnings = 0
        active_windows = 0
        warning_windows = 0

        for item in window_predictions:
            last_index = item["last_index"]
            stable_normal_window = item["stable_normal_window"]
            prediction = item["prediction"]
            total_windows += 1

            if scenario == "normal":
                normal_windows += 1
            elif recovery_index is not None and stable_normal_window:
                recovery_windows += 1

            # Active rule-based detections are scored separately and ignore forecast threshold.
            if prediction["active"]:
                active_windows += 1
                active_detection_windows += 1
                if scenario == "normal":
                    normal_warning_windows += 1
                    normal_episode_warnings += 1
                elif stable_normal_window and recovery_index is not None:
                    recovery_warning_windows += 1
                    recovery_warnings += 1
                elif onset is not None and last_index >= onset and (
                    recovery_index is None or last_index < recovery_index
                ):
                    fault_period_warnings += 1
                    warning_windows_during_fault += 1
                continue

            risk = float(prediction["risk"])
            if risk < threshold:
                continue

            warning_windows += 1
            predicted_type = str(prediction["best_fault_type"]).lower()

            if scenario == "normal":
                normal_warning_windows += 1
                normal_episode_warnings += 1
                continue

            if stable_normal_window and recovery_index is not None:
                recovery_warning_windows += 1
                recovery_warnings += 1
                continue

            if onset is not None and last_index < onset:
                if predicted_type != scenario:
                    wrong_class += 1
                    wrong_class_warning_windows += 1
                elif onset <= last_index + horizon_steps:
                    valid_hits.append(last_index)
                    valid_forecast_windows += 1
                else:
                    out_of_horizon += 1
                    out_of_horizon_hits.append(last_index)
                    out_of_horizon_warning_windows += 1
            elif onset is not None and recovery_index is not None and last_index >= onset:
                if last_index < recovery_index:
                    fault_period_warnings += 1
                    warning_windows_during_fault += 1
                else:
                    transition_warnings += 1
                    transition_warning_windows += 1
            else:
                transition_warnings += 1
                transition_warning_windows += 1

        first_valid_lead = None
        if valid_hits and onset is not None:
            first_valid_lead = (onset - min(valid_hits)) * INTERVAL_SECONDS / 60.0
        first_early_lead = None
        if out_of_horizon_hits and onset is not None:
            first_early_lead = (onset - min(out_of_horizon_hits)) * INTERVAL_SECONDS / 60.0

        episode_results.append(
            {
                "episode_id": int(episode_id),
                "scenario": scenario,
                "fault_onset_index": onset,
                "recovery_steady_state_start_index": recovery_index,
                "windows_tested": len(window_predictions),
                "warning_windows": warning_windows,
                "active_detection_windows": active_windows,
                "horizon_valid_forecast_windows": len(valid_hits),
                "episode_horizon_hit": bool(valid_hits),
                "first_horizon_valid_lead_time_minutes": first_valid_lead,
                "out_of_horizon_warning_windows": out_of_horizon,
                "early_warning_episode": bool(out_of_horizon_hits),
                "first_early_warning_lead_time_minutes": first_early_lead,
                "wrong_class_warning_windows": wrong_class,
                "warning_windows_during_active_fault": fault_period_warnings,
                "transition_warning_windows": transition_warnings,
                "recovery_windows_with_warning": recovery_warnings,
                "normal_episode_warning_windows": normal_episode_warnings,
            }
        )

    fault_episodes = [
        item for item in episode_results
        if item["scenario"] != "normal" and item["fault_onset_index"] is not None
    ]
    normal_episodes = [item for item in episode_results if item["scenario"] == "normal"]
    valid_episodes = [item for item in fault_episodes if item["episode_horizon_hit"]]
    early_episodes = [item for item in fault_episodes if item["early_warning_episode"]]
    lead_times = [
        item["first_horizon_valid_lead_time_minutes"]
        for item in valid_episodes
        if item["first_horizon_valid_lead_time_minutes"] is not None
    ]
    early_lead_times = [
        item["first_early_warning_lead_time_minutes"]
        for item in early_episodes
        if item["first_early_warning_lead_time_minutes"] is not None
    ]

    return {
        "threshold": threshold,
        "total_windows_tested": total_windows,
        "verified_fault_episodes": len(fault_episodes),
        "episodes_with_horizon_valid_forecast": len(valid_episodes),
        "episodes_missed_10_minute_window": len(fault_episodes) - len(valid_episodes),
        "horizon_valid_episode_detection_rate": rate(len(valid_episodes), len(fault_episodes)),
        "average_lead_time_of_first_valid_forecast_minutes": (
            sum(lead_times) / len(lead_times) if lead_times else None
        ),
        "out_of_horizon_warning_windows": out_of_horizon_warning_windows,
        "episodes_with_out_of_horizon_early_warning": len(early_episodes),
        "out_of_horizon_early_warning_episode_rate": rate(len(early_episodes), len(fault_episodes)),
        "average_lead_time_of_first_early_warning_minutes": (
            sum(early_lead_times) / len(early_lead_times) if early_lead_times else None
        ),
        "wrong_class_warning_windows": wrong_class_warning_windows,
        "active_detection_windows_separate": active_detection_windows,
        "warning_windows_during_active_fault": warning_windows_during_fault,
        "transition_warning_windows_not_scored_as_stable_false_alarms": transition_warning_windows,
        "normal_windows_tested": normal_windows,
        "normal_warning_windows": normal_warning_windows,
        "normal_window_false_positive_rate": rate(normal_warning_windows, normal_windows),
        "stable_recovery_windows_tested": recovery_windows,
        "stable_recovery_warning_windows": recovery_warning_windows,
        "stable_recovery_false_positive_rate": rate(recovery_warning_windows, recovery_windows),
        "normal_episodes": len(normal_episodes),
        "normal_episodes_with_warning": sum(
            item["normal_episode_warning_windows"] > 0 for item in normal_episodes
        ),
        "episode_results": episode_results,
    }


def main() -> None:
    for path in (ANOMALY_MODEL_PATH, CLASSIFIER_MODEL_PATH):
        if not path.exists():
            raise FileNotFoundError(
                f"Required saved model was not found: {path}. Run training first."
            )

    print("Preparing deterministic lead-time scenarios (no retraining)...")
    print(f"Thresholds: {', '.join(f'{value:.2f}' for value in THRESHOLDS)}")
    print(f"Episodes per class: {EPISODES_PER_CLASS}; window: {WINDOW_SIZE}; horizon: {FORECAST_HORIZON_MINUTES} min")

    anomaly_detector = AnomalyDetector(random_state=RANDOM_SEED)
    anomaly_detector.load(ANOMALY_MODEL_PATH)
    classifier = FaultClassifier(random_state=RANDOM_SEED)
    classifier.load(CLASSIFIER_MODEL_PATH)

    dataset = generate_dataset(
        episodes_per_class=EPISODES_PER_CLASS,
        duration_minutes=DURATION_MINUTES,
        interval_seconds=INTERVAL_SECONDS,
        random_seed=RANDOM_SEED,
    )

    episode_predictions: list[dict[str, Any]] = []
    for episode_id, original in dataset.groupby("episode_id", sort=True):
        original = original.sort_values("recorded_at").reset_index(drop=True)
        scenario = str(original["scenario_label"].iloc[0]).lower()
        episode = append_healthy_recovery(original, int(episode_id)) if scenario != "normal" else original.copy()
        episode = episode.sort_values("recorded_at").reset_index(drop=True)
        onset = find_fault_index(episode, scenario) if scenario != "normal" else None

        recovery_index = None
        if scenario != "normal" and onset is not None:
            for idx in range(onset + 1, len(episode)):
                end = idx + WINDOW_SIZE
                if end > len(episode):
                    continue
                labels = episode.loc[idx:end - 1, "scenario_label"]
                if episode.loc[idx, "scenario_label"] == "normal" and (labels == "normal").all():
                    recovery_index = idx
                    break

        window_predictions: list[dict[str, Any]] = []
        for end in range(WINDOW_SIZE, len(episode) + 1):
            window = episode.iloc[end - WINDOW_SIZE:end]
            prediction = predict_window(window, anomaly_detector, classifier)
            window_predictions.append(
                {
                    "last_index": end - 1,
                    "stable_normal_window": bool((window["scenario_label"] == "normal").all()),
                    "prediction": prediction,
                }
            )

        episode_predictions.append(
            {
                "episode_id": int(episode_id),
                "scenario": scenario,
                "onset": onset,
                "recovery_index": recovery_index,
                "window_predictions": window_predictions,
            }
        )
        print(
            f"Prepared episode {episode_id}: {scenario}; onset={onset}; "
            f"recovery_start={recovery_index}; windows={len(window_predictions)}"
        )

    reports = [score_threshold(threshold, episode_predictions) for threshold in THRESHOLDS]

    print("\nLEAD-TIME THRESHOLD COMPARISON (SYNTHETIC DATA)")
    print("-" * 124)
    print(
        f"{'Threshold':>9} {'Valid episodes':>15} {'Episode hit rate':>17} "
        f"{'Avg valid lead':>15} {'Out-of-horizon':>15} {'Wrong class':>12} "
        f"{'Normal FPR':>12} {'Recovery FPR':>13} {'Normal episodes warned':>23}"
    )
    for report in reports:
        hit_rate = report["horizon_valid_episode_detection_rate"]
        normal_fpr = report["normal_window_false_positive_rate"]
        recovery_fpr = report["stable_recovery_false_positive_rate"]
        lead = report["average_lead_time_of_first_valid_forecast_minutes"]
        print(
            f"{report['threshold']:>9.2f} "
            f"{report['episodes_with_horizon_valid_forecast']:>7}/"
            f"{report['verified_fault_episodes']:<7} "
            f"{(hit_rate * 100 if hit_rate is not None else 0):>16.2f}% "
            f"{(lead if lead is not None else 0):>14.2f}m "
            f"{report['out_of_horizon_warning_windows']:>15} "
            f"{report['wrong_class_warning_windows']:>12} "
            f"{(normal_fpr * 100 if normal_fpr is not None else 0):>11.2f}% "
            f"{(recovery_fpr * 100 if recovery_fpr is not None else 0):>12.2f}% "
            f"{report['normal_episodes_with_warning']:>23}"
        )

    report_doc = {
        "evaluation_type": "synthetic lead-time threshold comparison using saved models and local inference logic",
        "thresholds": list(THRESHOLDS),
        "episodes_per_class": EPISODES_PER_CLASS,
        "duration_minutes": DURATION_MINUTES,
        "recovery_minutes": RECOVERY_MINUTES,
        "window_size": WINDOW_SIZE,
        "forecast_horizon_minutes": FORECAST_HORIZON_MINUTES,
        "random_seed": RANDOM_SEED,
        "results": reports,
        "limitations": [
            "Uses synthetic simulator telemetry, not production incidents.",
            "Only five episodes per class are evaluated; results are indicative, not definitive.",
            "Active rule-based detections remain independent of the forecast threshold.",
            "This script evaluates thresholds locally and does not change the running service's configuration.",
        ],
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report_doc, indent=2), encoding="utf-8")
    print(f"\nComparison report saved to: {OUTPUT_PATH}")
    print("Saved model files, evaluation_results.json, and application settings were not modified.")


if __name__ == "__main__":
    main()
