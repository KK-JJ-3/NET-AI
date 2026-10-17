from __future__ import annotations

import json
from pathlib import Path

import requests

from simulator.dataset import generate_dataset


API_URL = "http://127.0.0.1:8000/predict"
HEALTH_URL = "http://127.0.0.1:8000/health"
OUTPUT_PATH = Path("models/lead_time_evaluation.json")

EPISODES_PER_CLASS = 5
DURATION_MINUTES = 60
WINDOW_SIZE = 15
WARNING_THRESHOLD = 0.60
RANDOM_SEED = 20261017
INTERVAL_SECONDS = 60

CONGESTION_UTILIZATION_THRESHOLD = 90.0
CONGESTION_LATENCY_THRESHOLD = 100.0


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


def find_fault_onset(episode):
    """Return the first row index meeting the defined onset criteria."""
    scenario = str(episode["scenario_label"].iloc[0]).lower()

    if scenario == "normal":
        return None

    if scenario == "device_failure":
        indices = episode.index[
            episode["availability"] == 0
        ].tolist()
        return int(indices[0]) if indices else None

    if scenario == "congestion":
        mask = (
            (episode["utilization_pct"]
             >= CONGESTION_UTILIZATION_THRESHOLD)
            & (episode["latency_ms"]
               >= CONGESTION_LATENCY_THRESHOLD)
        )
        indices = episode.index[mask].tolist()
        return int(indices[0]) if indices else None

    raise ValueError(f"Unknown scenario: {scenario}")


def request_prediction(session, rows: list[dict]) -> dict:
    payload = {
        "deviceId": 1,
        "window": [to_api_point(row) for row in rows],
    }

    response = session.post(
        API_URL,
        json=payload,
        timeout=30,
    )
    response.raise_for_status()

    result = response.json()

    if "riskScore" not in result:
        raise ValueError(
            f"Prediction response has no riskScore: {result}"
        )

    risk = float(result["riskScore"])

    if not 0.0 <= risk <= 1.0:
        raise ValueError(f"Invalid risk score: {risk}")

    return result


def calculate_rate(numerator: int, denominator: int):
    return numerator / denominator if denominator else None


def main():
    with requests.Session() as session:
        health = session.get(HEALTH_URL, timeout=10)
        health.raise_for_status()
        print("AI service is available.")

        print("Generating independent evaluation episodes...")
        dataset = generate_dataset(
            episodes_per_class=EPISODES_PER_CLASS,
            duration_minutes=DURATION_MINUTES,
            interval_seconds=INTERVAL_SECONDS,
            random_seed=RANDOM_SEED,
        )

        episode_results = []

        total_windows = 0
        normal_windows = 0
        normal_warning_windows = 0
        normal_episodes_with_warning = 0

        pre_fault_warning_windows = 0
        warnings_after_onset = 0
        fault_episodes_with_post_onset_warning = 0

        unverified_episode_warning_windows = 0
        unverified_episodes_with_warning = 0

        for episode_id, episode in dataset.groupby(
            "episode_id", sort=True
        ):
            episode = (
                episode.sort_values("recorded_at")
                .reset_index(drop=True)
            )

            scenario = str(
                episode["scenario_label"].iloc[0]
            ).lower()

            onset = find_fault_onset(episode)

            max_utilization = None
            max_latency = None
            thresholds_reached_together = None

            if scenario == "congestion":
                max_utilization = float(
                    episode["utilization_pct"].max()
                )
                max_latency = float(
                    episode["latency_ms"].max()
                )
                thresholds_reached_together = onset is not None

                print(
                    f"  Max utilization: {max_utilization:.2f}%"
                )
                print(
                    f"  Max latency: {max_latency:.2f} ms"
                )
                print(
                    "  Thresholds reached together: "
                    f"{thresholds_reached_together}"
                )

            evaluated_windows = 0
            warning_windows = 0
            pre_fault_warnings = 0
            post_onset_warnings = 0

            first_warning_index = None
            first_pre_fault_warning_index = None
            first_post_onset_warning_index = None

            for end in range(
                WINDOW_SIZE,
                len(episode) + 1,
            ):
                window = episode.iloc[end - WINDOW_SIZE:end]

                result = request_prediction(
                    session,
                    window.to_dict("records"),
                )

                risk = float(result["riskScore"])
                warning = risk >= WARNING_THRESHOLD

                # A prediction is timestamped at the newest reading
                # included in its telemetry window.
                last_index = end - 1
                evaluated_windows += 1
                total_windows += 1

                if scenario == "normal":
                    normal_windows += 1

                if not warning:
                    continue

                warning_windows += 1

                if first_warning_index is None:
                    first_warning_index = last_index

                if scenario == "normal":
                    normal_warning_windows += 1
                    continue

                if onset is None:
                    unverified_episode_warning_windows += 1
                    continue

                if last_index < onset:
                    pre_fault_warnings += 1
                    pre_fault_warning_windows += 1

                    if first_pre_fault_warning_index is None:
                        first_pre_fault_warning_index = last_index
                else:
                    post_onset_warnings += 1
                    warnings_after_onset += 1

                    if first_post_onset_warning_index is None:
                        first_post_onset_warning_index = last_index

            detected_before_fault = (
                onset is not None
                and first_pre_fault_warning_index is not None
            )

            lead_time_minutes = None

            if detected_before_fault:
                lead_time_minutes = (
                    onset - first_pre_fault_warning_index
                ) * INTERVAL_SECONDS / 60.0

            if scenario == "normal" and warning_windows > 0:
                normal_episodes_with_warning += 1

            if (
                scenario != "normal"
                and onset is None
                and warning_windows > 0
            ):
                unverified_episodes_with_warning += 1

            if scenario != "normal" and post_onset_warnings > 0:
                fault_episodes_with_post_onset_warning += 1

            episode_result = {
                "episode_id": int(episode_id),
                "scenario": scenario,
                "fault_onset_index": onset,
                "fault_onset_elapsed_minutes": (
                    onset * INTERVAL_SECONDS / 60.0
                    if onset is not None else None
                ),
                "max_utilization_pct": max_utilization,
                "max_latency_ms": max_latency,
                "congestion_thresholds_reached_together": (
                    thresholds_reached_together
                ),
                "windows_tested": evaluated_windows,
                "warning_windows": warning_windows,
                "pre_fault_warning_windows": pre_fault_warnings,
                "post_onset_warning_windows": post_onset_warnings,
                "first_warning_index": first_warning_index,
                "first_pre_fault_warning_index": (
                    first_pre_fault_warning_index
                ),
                "first_post_onset_warning_index": (
                    first_post_onset_warning_index
                ),
                "detected_before_fault": detected_before_fault,
                "lead_time_minutes": lead_time_minutes,
            }

            episode_results.append(episode_result)

            if scenario == "normal":
                status = (
                    "NORMAL EPISODE WITH WARNING"
                    if warning_windows > 0
                    else "NORMAL EPISODE"
                )
            elif onset is None:
                status = (
                    "UNVERIFIED ONSET WITH WARNING"
                    if warning_windows > 0
                    else "NO VERIFIED ONSET"
                )
            elif detected_before_fault:
                status = "EARLY WARNING"
            else:
                status = "MISSED BEFORE ONSET"

            print(
                f"Episode {episode_id}: {scenario}; "
                f"onset={onset}; status={status}; "
                f"warnings={warning_windows}; "
                f"pre_fault={pre_fault_warnings}; "
                f"post_onset={post_onset_warnings}; "
                f"lead_time={lead_time_minutes}"
            )

        fault_episodes = [
            item for item in episode_results
            if item["scenario"] != "normal"
            and item["fault_onset_index"] is not None
        ]

        detected_episodes = [
            item for item in fault_episodes
            if item["detected_before_fault"]
        ]

        missed_episodes = [
            item for item in fault_episodes
            if not item["detected_before_fault"]
        ]

        lead_times = [
            item["lead_time_minutes"]
            for item in detected_episodes
            if item["lead_time_minutes"] is not None
        ]

        unverified_episodes = [
            item for item in episode_results
            if item["scenario"] != "normal"
            and item["fault_onset_index"] is None
        ]

        normal_episodes = [
            item for item in episode_results
            if item["scenario"] == "normal"
        ]

        report = {
            "random_seed": RANDOM_SEED,
            "episodes_per_class": EPISODES_PER_CLASS,
            "duration_minutes": DURATION_MINUTES,
            "interval_seconds": INTERVAL_SECONDS,
            "window_size": WINDOW_SIZE,
            "forecast_horizon_minutes": 30,
            "warning_threshold": WARNING_THRESHOLD,
            "total_windows_tested": total_windows,

            "fault_episodes_generated": sum(
                item["scenario"] != "normal"
                for item in episode_results
            ),
            "fault_episodes_with_verified_onset": len(
                fault_episodes
            ),
            "fault_episodes_without_verified_onset": len(
                unverified_episodes
            ),
            "detected_before_fault": len(detected_episodes),
            "missed_before_fault": len(missed_episodes),
            "pre_fault_detection_rate": calculate_rate(
                len(detected_episodes),
                len(fault_episodes),
            ),
            "average_lead_time_minutes": (
                sum(lead_times) / len(lead_times)
                if lead_times else None
            ),
            "minimum_lead_time_minutes": (
                min(lead_times) if lead_times else None
            ),
            "maximum_lead_time_minutes": (
                max(lead_times) if lead_times else None
            ),

            "pre_fault_warning_windows": pre_fault_warning_windows,
            "warning_windows_after_fault_onset": warnings_after_onset,
            "fault_episodes_with_post_onset_warning": (
                fault_episodes_with_post_onset_warning
            ),
            "fault_episode_post_onset_warning_rate": calculate_rate(
                fault_episodes_with_post_onset_warning,
                len(fault_episodes),
            ),

            "normal_episodes": len(normal_episodes),
            "normal_episodes_with_warning": (
                normal_episodes_with_warning
            ),
            "normal_episode_warning_rate": calculate_rate(
                normal_episodes_with_warning,
                len(normal_episodes),
            ),
            "normal_windows_tested": normal_windows,
            "normal_warning_windows": normal_warning_windows,
            "normal_window_false_positive_rate": calculate_rate(
                normal_warning_windows,
                normal_windows,
            ),

            "unverified_episodes_with_warning": (
                unverified_episodes_with_warning
            ),
            "warnings_in_fault_scenarios_without_verified_onset": (
                unverified_episode_warning_windows
            ),

            "episode_results": episode_results,
            "limitations": [
                "Evaluation uses synthetic telemetry.",
                "Fault onset is defined by simulator thresholds.",
                "A warning is timestamped at the newest reading "
                "in its 15-reading window.",
                "Overlapping windows are not statistically independent.",
                "Post-onset warnings may be ongoing-fault alerts, "
                "not necessarily false positives.",
                "The 30-minute forecast horizon is configured in "
                "the model; lead time is measured separately.",
                "The number of evaluated episodes is small.",
            ],
        }

        OUTPUT_PATH.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        OUTPUT_PATH.write_text(
            json.dumps(report, indent=2),
            encoding="utf-8",
        )

        print("\n=== Evaluation summary ===")
        print(f"Windows tested: {total_windows}")
        print(
            "Verified fault episodes: "
            f"{len(fault_episodes)}"
        )
        print(
            "Detected before onset: "
            f"{len(detected_episodes)} / {len(fault_episodes)}"
        )
        print(
            "Pre-fault detection rate: "
            f"{report['pre_fault_detection_rate']}"
        )
        print(
            "Average lead time: "
            f"{report['average_lead_time_minutes']} minutes"
        )
        print(
            "Pre-fault warning windows: "
            f"{pre_fault_warning_windows}"
        )
        print(
            "Post-onset warning windows: "
            f"{warnings_after_onset}"
        )
        print(
            "Fault episodes with post-onset warnings: "
            f"{fault_episodes_with_post_onset_warning} / "
            f"{len(fault_episodes)}"
        )
        print(
            "Normal episode warning rate: "
            f"{report['normal_episode_warning_rate']}"
        )
        print(
            "Normal-window false-positive rate: "
            f"{report['normal_window_false_positive_rate']}"
        )
        print(f"Report saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()