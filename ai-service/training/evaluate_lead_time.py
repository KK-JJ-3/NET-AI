from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import requests

from simulator.dataset import generate_dataset
from simulator.scenarios import ScenarioConfig, ScenarioLabel, generate_scenario
from training.fault_thresholds import find_fault_index

API_URL = "http://127.0.0.1:8000/predict"
HEALTH_URL = "http://127.0.0.1:8000/health"
OUTPUT_PATH = Path("models/lead_time_evaluation.json")

EPISODES_PER_CLASS = 5
DURATION_MINUTES = 60
RECOVERY_MINUTES = 20
WINDOW_SIZE = 15
WARNING_THRESHOLD = 0.40
RANDOM_SEED = 20261017
INTERVAL_SECONDS = 60
FORECAST_HORIZON_MINUTES = 10


def to_api_point(row: dict) -> dict:
    return {
        "recordedAt": row["recorded_at"].isoformat(),
        "latencyMs": float(row["latency_ms"]),
        "packetLossPct": float(row["packet_loss_pct"]),
        "jitterMs": float(row["jitter_ms"]),
        "utilizationPct": float(row["utilization_pct"]),
        "cpuPct": float(row["cpu_pct"]),
        "memoryPct": float(row["memory_pct"]),
        "availability": int(row["availability"]),
    }


def append_healthy_recovery(episode, episode_id: int):
    """Append a separate steady-normal tail so recovery can be evaluated."""
    import pandas as pd

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


def find_fault_onset(episode, scenario: str):
    if scenario == "normal":
        return None

    return find_fault_index(episode, scenario)


def request_prediction(session, rows: list[dict]) -> dict:
    response = session.post(
        API_URL,
        json={
            "deviceId": 1,
            "window": [to_api_point(row) for row in rows],
        },
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()

    if "riskScore" not in result:
        raise ValueError(f"Prediction response has no riskScore: {result}")

    risk = float(result["riskScore"])
    if not 0.0 <= risk <= 1.0:
        raise ValueError(f"Invalid risk score: {risk}")

    if "predictedWindowMinutes" not in result:
        raise ValueError(
            "Prediction response has no predictedWindowMinutes; "
            "cannot score horizon-valid forecasts."
        )

    horizon = int(result["predictedWindowMinutes"])
    if horizon <= 0:
        raise ValueError(f"Invalid prediction horizon: {horizon}")

    return result


def rate(numerator: int, denominator: int):
    return numerator / denominator if denominator else None


def is_horizon_valid(
    onset_index: int,
    prediction_index: int,
    predicted_window_minutes: int,
    interval_seconds: int = INTERVAL_SECONDS,
) -> bool:
    """Return whether onset is strictly after prediction and within its own horizon."""
    if predicted_window_minutes <= 0 or interval_seconds <= 0:
        return False
    steps_until_onset = onset_index - prediction_index
    if steps_until_onset <= 0:
        return False
    horizon_steps = (predicted_window_minutes * 60) // interval_seconds
    return steps_until_onset <= horizon_steps


def main():
    import pandas as pd

    with requests.Session() as session:
        health = session.get(HEALTH_URL, timeout=10)
        health.raise_for_status()
        print("AI service is available.")

        dataset = generate_dataset(
            episodes_per_class=EPISODES_PER_CLASS,
            duration_minutes=DURATION_MINUTES,
            interval_seconds=INTERVAL_SECONDS,
            random_seed=RANDOM_SEED,
        )

        episode_results = []

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

        for episode_id, original in dataset.groupby("episode_id", sort=True):
            original = original.sort_values("recorded_at").reset_index(drop=True)
            scenario = str(original["scenario_label"].iloc[0]).lower()

            if scenario != "normal":
                episode = append_healthy_recovery(original, int(episode_id))
            else:
                episode = original.copy()

            episode = episode.sort_values("recorded_at").reset_index(drop=True)
            onset = find_fault_onset(episode, scenario)

            recovery_index = None

            if scenario != "normal" and onset is not None:
                for idx in range(onset + 1, len(episode)):
                    recovery_window_end = idx + WINDOW_SIZE

                    if recovery_window_end > len(episode):
                        continue

                    recovery_labels = episode.loc[
                        idx:recovery_window_end - 1, "scenario_label"
                    ]

                    if (
                        episode.loc[idx, "scenario_label"] == "normal"
                        and (recovery_labels == "normal").all()
                    ):
                        recovery_index = idx
                        break

            warning_windows = 0
            active_windows = 0
            valid_hits = []
            out_of_horizon_hits = []
            out_of_horizon = 0
            wrong_class = 0
            recovery_warnings = 0
            normal_episode_warnings = 0
            transition_warnings = 0
            fault_period_warnings = 0
            evaluated_windows = 0

            for end in range(WINDOW_SIZE, len(episode) + 1):
                window = episode.iloc[end - WINDOW_SIZE:end]
                last_index = end - 1

                result = request_prediction(
                    session,
                    window.to_dict("records"),
                )

                evaluated_windows += 1
                total_windows += 1

                stable_normal_window = (
                    window["scenario_label"] == "normal"
                ).all()

                if scenario == "normal":
                    normal_windows += 1
                elif recovery_index is not None and stable_normal_window:
                    recovery_windows += 1

                explanation = str(result.get("explanationText", ""))
                active = (
                    "[ACTIVE_FAULT_DETECTION]" in explanation
                    or "[RULE_BASED]" in explanation
                )

                # Active fault detections are not future forecasts.
                if active:
                    active_windows += 1
                    active_detection_windows += 1

                    if scenario == "normal":
                        normal_warning_windows += 1
                        normal_episode_warnings += 1
                    elif (
                        stable_normal_window
                        and recovery_index is not None
                    ):
                        recovery_warning_windows += 1
                        recovery_warnings += 1
                    elif (
                        onset is not None
                        and last_index >= onset
                        and (
                            recovery_index is None
                            or last_index < recovery_index
                        )
                    ):
                        fault_period_warnings += 1
                        warning_windows_during_fault += 1

                    continue

                risk = float(result["riskScore"])
                predicted_type = str(
                    result.get("faultType", "normal")
                ).lower()

                if risk < WARNING_THRESHOLD:
                    continue

                warning_windows += 1

                horizon_minutes = int(result["predictedWindowMinutes"])

                # Normal episodes are evaluated separately.
                if scenario == "normal":
                    normal_warning_windows += 1
                    normal_episode_warnings += 1
                    continue

                # Only stable normal recovery windows count as
                # recovery false alarms.
                if (
                    stable_normal_window
                    and recovery_index is not None
                ):
                    recovery_warning_windows += 1
                    recovery_warnings += 1
                    continue

                if onset is not None and last_index < onset:
                    # A matching fault type is required before
                    # assessing whether the warning was early or valid.
                    if predicted_type != scenario:
                        wrong_class += 1
                        wrong_class_warning_windows += 1
                    elif is_horizon_valid(
                        onset_index=onset,
                        prediction_index=last_index,
                        predicted_window_minutes=horizon_minutes,
                    ):
                        valid_hits.append(last_index)
                        valid_forecast_windows += 1
                    else:
                        # Correct fault type, but onset lies outside
                        # the prediction's declared horizon.
                        out_of_horizon += 1
                        out_of_horizon_hits.append(last_index)
                        out_of_horizon_warning_windows += 1

                elif (
                    onset is not None
                    and recovery_index is not None
                    and last_index >= onset
                ):
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
                first_valid_lead = (
                    (onset - min(valid_hits))
                    * INTERVAL_SECONDS
                    / 60.0
                )

            first_early_lead = None
            if out_of_horizon_hits and onset is not None:
                first_early_lead = (
                    (onset - min(out_of_horizon_hits))
                    * INTERVAL_SECONDS
                    / 60.0
                )

            episode_results.append(
                {
                    "episode_id": int(episode_id),
                    "scenario": scenario,
                    "fault_onset_index": onset,
                    "fault_onset_elapsed_minutes": (
                        onset * INTERVAL_SECONDS / 60.0
                        if onset is not None
                        else None
                    ),
                    "recovery_steady_state_start_index": recovery_index,
                    "windows_tested": evaluated_windows,
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

            if scenario == "normal":
                status = (
                    "NORMAL WITH FALSE ALARM"
                    if normal_episode_warnings
                    else "NORMAL"
                )
            elif onset is None:
                status = "ONSET UNVERIFIED"
            elif valid_hits:
                status = "HORIZON-VALID FORECAST"
            else:
                status = "MISSED 10-MINUTE WINDOW"

            print(
                f"Episode {episode_id}: {scenario}; onset={onset}; "
                f"recovery_start={recovery_index}; status={status}; "
                f"valid_hits={len(valid_hits)}; "
                f"out_of_horizon={out_of_horizon}; "
                f"recovery_warnings={recovery_warnings}; "
                f"active={active_windows}"
            )

        fault_episodes = [
            item
            for item in episode_results
            if (
                item["scenario"] != "normal"
                and item["fault_onset_index"] is not None
            )
        ]

        normal_episodes = [
            item
            for item in episode_results
            if item["scenario"] == "normal"
        ]

        valid_episodes = [
            item for item in fault_episodes
            if item["episode_horizon_hit"]
        ]

        early_warning_episodes = [
            item for item in fault_episodes
            if item["early_warning_episode"]
        ]

        lead_times = [
            item["first_horizon_valid_lead_time_minutes"]
            for item in valid_episodes
            if item["first_horizon_valid_lead_time_minutes"] is not None
        ]

        early_warning_lead_times = [
            item["first_early_warning_lead_time_minutes"]
            for item in early_warning_episodes
            if item["first_early_warning_lead_time_minutes"] is not None
        ]

        report = {
            "evaluation_type": (
                "synthetic horizon-aware forecast and recovery evaluation"
            ),
            "random_seed": RANDOM_SEED,
            "episodes_per_class": EPISODES_PER_CLASS,
            "base_duration_minutes": DURATION_MINUTES,
            "appended_healthy_recovery_minutes": RECOVERY_MINUTES,
            "interval_seconds": INTERVAL_SECONDS,
            "window_size": WINDOW_SIZE,
            "forecast_horizon_minutes_configured": FORECAST_HORIZON_MINUTES,
            "warning_threshold": WARNING_THRESHOLD,
            "total_windows_tested": total_windows,
            "verified_fault_episodes": len(fault_episodes),
            "episodes_with_horizon_valid_forecast": len(valid_episodes),
            "episodes_missed_10_minute_window": (
                len(fault_episodes) - len(valid_episodes)
            ),
            "horizon_valid_episode_detection_rate": rate(
                len(valid_episodes), len(fault_episodes)
            ),
            "average_lead_time_of_first_valid_forecast_minutes": (
                sum(lead_times) / len(lead_times)
                if lead_times
                else None
            ),
            "minimum_valid_lead_time_minutes": (
                min(lead_times) if lead_times else None
            ),
            "maximum_valid_lead_time_minutes": (
                max(lead_times) if lead_times else None
            ),
            "horizon_valid_forecast_windows": valid_forecast_windows,
            "out_of_horizon_warning_windows": out_of_horizon_warning_windows,
            "episodes_with_out_of_horizon_early_warning": len(
                early_warning_episodes
            ),
            "out_of_horizon_early_warning_episode_rate": rate(
                len(early_warning_episodes),
                len(fault_episodes),
            ),
            "average_lead_time_of_first_early_warning_minutes": (
                sum(early_warning_lead_times)
                / len(early_warning_lead_times)
                if early_warning_lead_times
                else None
            ),
            "minimum_first_early_warning_lead_time_minutes": (
                min(early_warning_lead_times)
                if early_warning_lead_times
                else None
            ),
            "maximum_first_early_warning_lead_time_minutes": (
                max(early_warning_lead_times)
                if early_warning_lead_times
                else None
            ),
            "wrong_class_warning_windows": wrong_class_warning_windows,
            "active_detection_windows_separate": active_detection_windows,
            "warning_windows_during_active_fault": warning_windows_during_fault,
            "transition_warning_windows_not_scored_as_stable_false_alarms": (
                transition_warning_windows
            ),
            "normal_windows_tested": normal_windows,
            "normal_warning_windows": normal_warning_windows,
            "normal_window_false_positive_rate": rate(
                normal_warning_windows, normal_windows
            ),
            "stable_recovery_windows_tested": recovery_windows,
            "stable_recovery_warning_windows": recovery_warning_windows,
            "stable_recovery_false_positive_rate": rate(
                recovery_warning_windows, recovery_windows
            ),
            "normal_episodes": len(normal_episodes),
            "normal_episodes_with_warning": sum(
                item["normal_episode_warning_windows"] > 0
                for item in normal_episodes
            ),
            "episode_results": episode_results,
            "limitations": [
                "Evaluation uses synthetic telemetry, not production incidents.",
                "Fault onset is defined by simulator thresholds.",
                (
                    "A horizon-valid hit requires a matching predicted "
                    "fault type and onset strictly after prediction time "
                    "but no later than predictedWindowMinutes."
                ),
                (
                    "Correctly classified warnings outside the returned "
                    "horizon are reported separately and are not counted "
                    "as horizon-valid hits."
                ),
                (
                    "Early-warning episode metrics count an episode once "
                    "if it has at least one matching-type out-of-horizon "
                    "warning; overlapping windows are not independent."
                ),
                "Active-rule detections are tracked separately from future forecasts.",
                (
                    "A stable recovery window requires all 15 input "
                    "readings to be labeled normal."
                ),
                "Five episodes per class are only a smoke evaluation, not a reliability estimate.",
            ],
        }

        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(
            json.dumps(report, indent=2),
            encoding="utf-8",
        )

        print("\n=== Horizon-aware evaluation summary ===")
        print(f"Windows tested: {total_windows}")
        print(
            f"Horizon-valid fault episodes: "
            f"{len(valid_episodes)} / {len(fault_episodes)}"
        )
        print(
            "Horizon-valid episode detection rate: "
            f"{report['horizon_valid_episode_detection_rate']}"
        )
        print(
            "Average lead time of first valid forecast: "
            f"{report['average_lead_time_of_first_valid_forecast_minutes']}"
        )
        print(f"Out-of-horizon warning windows: {out_of_horizon_warning_windows}")
        print(
            "Episodes with early warnings: "
            f"{len(early_warning_episodes)} / {len(fault_episodes)}"
        )
        print(
            "Average lead time of first early warning: "
            f"{report['average_lead_time_of_first_early_warning_minutes']}"
        )
        print(f"Wrong-class warnings: {wrong_class_warning_windows}")
        print(
            "Normal-window false-positive rate: "
            f"{report['normal_window_false_positive_rate']}"
        )
        print(f"Stable recovery windows tested: {recovery_windows}")
        print(f"Stable recovery warnings: {recovery_warning_windows}")
        print(
            "Stable recovery false-positive rate: "
            f"{report['stable_recovery_false_positive_rate']}"
        )
        print(f"Active-detection windows (separate): {active_detection_windows}")
        print(f"Report saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
