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
        First row of two consecutive unavailable readings, matching
        the active-failure rule used by the inference service.

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
        unavailable = (
            episode["availability"].astype(float).to_numpy() == 0
        )
        for index in range(1, len(unavailable)):
            if unavailable[index - 1] and unavailable[index]:
                return index - 1
        return None

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