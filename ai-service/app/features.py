from __future__ import annotations

import numpy as np

from app.schemas import TelemetryPoint


BASE_FEATURE_FIELDS = (
    "latency_ms",
    "packet_loss_pct",
    "jitter_ms",
    "utilization_pct",
    "cpu_pct",
    "memory_pct",
    "availability",
)


def _values(
    window: list[TelemetryPoint],
    field: str,
) -> np.ndarray:
    values = [
        getattr(point, field)
        for point in window
        if getattr(point, field) is not None
    ]

    if not values:
        return np.array([], dtype=float)

    return np.asarray(
        values,
        dtype=float,
    )


def _mean(values: np.ndarray) -> float:
    if values.size == 0:
        return 0.0

    return float(np.mean(values))


def _max(values: np.ndarray) -> float:
    if values.size == 0:
        return 0.0

    return float(np.max(values))


def _std(values: np.ndarray) -> float:
    if values.size < 2:
        return 0.0

    return float(np.std(values))


def _slope(values: np.ndarray) -> float:
    if values.size < 2:
        return 0.0

    x = np.arange(
        values.size,
        dtype=float,
    )

    return float(
        np.polyfit(x, values, 1)[0]
    )


def build_features(
    window: list[TelemetryPoint],
) -> dict[str, float]:
    """
    Build the same feature structure used by the
    training pipeline.

    Each telemetry metric produces:
    current, mean, max, std, slope.

    7 metrics × 5 features = 35 features.
    """

    if not window:
        raise ValueError(
            "Telemetry window cannot be empty"
        )

    features: dict[str, float] = {}

    for field in BASE_FEATURE_FIELDS:
        values = _values(
            window,
            field,
        )

        features[
            f"{field}_current"
        ] = (
            float(values[-1])
            if values.size
            else 0.0
        )

        features[
            f"{field}_mean"
        ] = _mean(values)

        features[
            f"{field}_max"
        ] = _max(values)

        features[
            f"{field}_std"
        ] = _std(values)

        features[
            f"{field}_slope"
        ] = _slope(values)

    return features