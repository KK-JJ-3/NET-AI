from __future__ import annotations
import pytest
import numpy as np
import pandas as pd

from simulator.dataset import generate_dataset
from training.fault_thresholds import find_fault_index
from training.prepare import build_training_features


def _congestion_episode() -> pd.DataFrame:
    rows = []
    start = pd.Timestamp("2026-01-01T00:00:00Z")
    for i in range(40):
        active = 22 <= i < 28
        recovered = i >= 28
        rows.append({
            "episode_id": 1,
            "recorded_at": start + pd.Timedelta(minutes=i),
            "scenario_label": "normal" if recovered else "congestion",
            "latency_ms": 140.0 if active else (30.0 + i * 0.4 if i < 22 else 30.0),
            "packet_loss_pct": 8.0 if active else 0.4,
            "jitter_ms": 25.0 if active else 3.5,
            "utilization_pct": 95.0 if active else (40.0 + i if i < 22 else 40.0),
            "cpu_pct": 80.0 if active else 35.0,
            "memory_pct": 85.0 if active else 50.0,
            "availability": 1,
        })
    return pd.DataFrame(rows)


def test_recovery_windows_are_included_as_normal_and_active_windows_excluded():
    features = build_training_features(
        _congestion_episode(), window_size=15, future_horizon_minutes=10
    )

    recovery_rows = features[
        (features["latency_ms_current"] == 30.0)
        & (features["target_label"] == "normal")
    ]
    assert len(recovery_rows) > 0

    active_endpoint_rows = features[
        features["latency_ms_current"] == 140.0
    ]
    assert active_endpoint_rows.empty
    assert "congestion" in set(features["target_label"])


def test_feature_window_does_not_use_future_telemetry():
    original = _congestion_episode()
    changed = original.copy(deep=True)

    # Window ending at index 20 covers rows 6..20.
    # Change only rows after its endpoint.
    changed.loc[21:, [
        "latency_ms", "packet_loss_pct", "jitter_ms",
        "utilization_pct", "cpu_pct", "memory_pct",
    ]] = 999.0

    before = build_training_features(original, window_size=15)
    after = build_training_features(changed, window_size=15)

    feature_columns = [
        c for c in before.columns
        if c not in {"episode_id", "target_label"}
    ]

    # Compare feature values for windows ending before the changed readings.
    pd.testing.assert_frame_equal(
        before.loc[:5, feature_columns].reset_index(drop=True),
        after.loc[:5, feature_columns].reset_index(drop=True),
    )


def test_device_failure_onset_requires_two_consecutive_unavailable_samples():
    episode = pd.DataFrame({
        "recorded_at": pd.date_range(
            "2026-01-01", periods=5, freq="min", tz="UTC"
        ),
        "availability": [1, 0, 1, 0, 0],
        "latency_ms": [30, 0, 30, 0, 0],
        "utilization_pct": [40, 40, 40, 40, 40],
    })
    assert find_fault_index(episode, "device_failure") == 3


def test_dataset_contains_healthy_recovery_after_fault_episodes():
    data = generate_dataset(
        episodes_per_class=3,
        duration_minutes=60,
        random_seed=20261019,
    )
    found_recovery = False
    for _, episode in data.groupby("episode_id"):
        labels = episode["scenario_label"].astype(str).tolist()
        availability = episode["availability"].tolist()
        first_unavailable = next(
            (i for i, value in enumerate(availability) if value == 0), None
        )
        if first_unavailable is not None and "normal" in labels[first_unavailable + 1:]:
            found_recovery = True
            break
    assert found_recovery

def test_training_rejects_missing_telemetry_values():
    data = _congestion_episode()
    data.loc[5, "latency_ms"] = np.nan

    with pytest.raises(
        ValueError,
        match="missing or non-numeric",
    ):
        build_training_features(data)


def test_training_rejects_infinite_telemetry_values():
    data = _congestion_episode()
    data.loc[5, "latency_ms"] = np.inf

    with pytest.raises(
        ValueError,
        match="NaN or infinite",
    ):
        build_training_features(data)