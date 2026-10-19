from datetime import datetime, timedelta, timezone

import pytest

from app.predictor import FaultPredictor
from app.schemas import TelemetryPoint


def _make_window() -> list[TelemetryPoint]:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    window = []

    for index in range(15):
        window.append(
            TelemetryPoint(
                recordedAt=start + timedelta(minutes=index),
                latencyMs=30.0,
                packetLossPct=0.5,
                jitterMs=3.0,
                utilizationPct=40.0,
                cpuPct=35.0,
                memoryPct=50.0,
                availability=1.0,
            )
        )

    # Simulate an active device failure at the end of the window.
    window[-2].availability = 0.0
    window[-1].availability = 0.0

    return window


def _make_predictor() -> FaultPredictor:
    # These dependencies should not be called because validation
    # must reject the window before inference begins.
    return FaultPredictor(
        anomaly_detector=None,
        classifier=None,
        feature_importance={},
        normal_baseline={},
    )


def test_inference_rejects_missing_metric_before_active_detection():
    window = _make_window()
    window[0].latency_ms = None

    with pytest.raises(
        ValueError,
        match="Telemetry point 0 has missing 'latency_ms'",
    ):
        _make_predictor().predict(window)


def test_inference_rejects_non_finite_metric():
    window = _make_window()
    window[0].latency_ms = float("inf")

    with pytest.raises(
        ValueError,
        match="Telemetry point 0 has non-finite 'latency_ms'",
    ):
        _make_predictor().predict(window)