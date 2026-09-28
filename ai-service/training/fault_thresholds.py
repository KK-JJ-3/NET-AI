from __future__ import annotations

import pandas as pd


CONGESTION_UTILIZATION_THRESHOLD = 90.0
CONGESTION_LATENCY_THRESHOLD = 100.0


def find_fault_index(
    episode: pd.DataFrame,
    scenario: str,
) -> int | None:
    """
    Find the first telemetry row representing actual fault onset.

    Device failure:
        First row where availability becomes 0.

    Congestion:
        First row where both utilization and latency
        reach the defined congestion thresholds.
    """

    if episode.empty:
        return None

    episode = episode.sort_values(
        "recorded_at"
    ).reset_index(drop=True)

    if scenario == "device_failure":
        failure_indices = episode.index[
            episode["availability"] == 0
        ].tolist()

        if not failure_indices:
            return None

        return failure_indices[0]

    if scenario == "congestion":
        congestion_mask = (
            episode["utilization_pct"]
            >= CONGESTION_UTILIZATION_THRESHOLD
        ) & (
            episode["latency_ms"]
            >= CONGESTION_LATENCY_THRESHOLD
        )

        congestion_indices = episode.index[
            congestion_mask
        ].tolist()

        if not congestion_indices:
            return None

        return congestion_indices[0]

    return None