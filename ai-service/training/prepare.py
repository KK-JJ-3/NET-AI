from __future__ import annotations

import numpy as np
import pandas as pd

from simulator.dataset import generate_dataset
from training.fault_thresholds import find_fault_index


BASE_FEATURE_COLUMNS = [
    "latency_ms",
    "packet_loss_pct",
    "jitter_ms",
    "utilization_pct",
    "cpu_pct",
    "memory_pct",
    "availability",
]

# Forecast whether a fault begins within the next 10 minutes.
FUTURE_HORIZON_MINUTES = 10

FAULT_LABELS = {"congestion", "device_failure"}


def _safe_slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0

    x = np.arange(len(values), dtype=float)
    y = np.asarray(values, dtype=float)

    return float(np.polyfit(x, y, 1)[0])


def _episode_fault_type(episode: pd.DataFrame) -> str:
    """Identify the fault scenario represented by an episode."""
    labels = (
        episode["scenario_label"]
        .astype(str)
        .str.strip()
        .str.lower()
    )

    for label in labels:
        if label in FAULT_LABELS:
            return label

    return "normal"


def build_training_features(
    data: pd.DataFrame,
    window_size: int = 15,
    future_horizon_minutes: int = FUTURE_HORIZON_MINUTES,
) -> pd.DataFrame:
    """
    Build rolling telemetry features with future-onset labels.

    Features use only the current row and previous rows from the
    same episode. The target is a fault type if its measured onset
    occurs within the future horizon; otherwise it is normal.

    Active-fault windows are excluded because active detection is handled
    separately. Healthy recovery windows are retained and labeled normal,
    including windows whose history still contains fault telemetry. This
    teaches the forecaster to distinguish recovery from a future fault.
    """
    if window_size <= 0:
        raise ValueError("window_size must be greater than 0")

    if future_horizon_minutes <= 0:
        raise ValueError(
            "future_horizon_minutes must be greater than 0"
        )

    required_columns = {
        "episode_id",
        "recorded_at",
        "scenario_label",
        *BASE_FEATURE_COLUMNS,
    }

    missing_columns = required_columns.difference(data.columns)

    if missing_columns:
        raise ValueError(
            f"Missing required columns: {sorted(missing_columns)}"
        )

    if data.empty:
        raise ValueError("Input dataset cannot be empty")

    # Validate telemetry before sorting or calculating features.
    # Coerce invalid strings to NaN so they are rejected consistently.
    numeric_data: pd.DataFrame = data[BASE_FEATURE_COLUMNS].apply(
        pd.to_numeric,
        errors="coerce",
    )

    missing_mask = numeric_data.isna()

    if missing_mask.any().any():
        invalid_columns = sorted(
            missing_mask.columns[
                missing_mask.any()
            ].tolist()
        )
        raise ValueError(
            "Telemetry contains missing or non-numeric values in: "
            f"{invalid_columns}"
        )

    numeric_values = numeric_data.to_numpy(dtype=float)

    if not np.isfinite(numeric_values).all():
        raise ValueError(
            "Telemetry contains NaN or infinite numeric values"
        )

    data = data.copy()
    data[BASE_FEATURE_COLUMNS] = numeric_data

    data = data.sort_values(
        ["episode_id", "recorded_at"]
    ).reset_index(drop=True)

    horizon = pd.Timedelta(
        minutes=future_horizon_minutes
    )

    rows: list[dict[str, float | int | str]] = []

    for episode_id, episode in data.groupby(
        "episode_id",
        sort=False,
    ):
        episode = episode.sort_values(
            "recorded_at"
        ).reset_index(drop=True)

        fault_type = _episode_fault_type(episode)

        fault_index = (
            find_fault_index(episode, fault_type)
            if fault_type in FAULT_LABELS
            else None
        )

        fault_time = (
            episode.iloc[fault_index]["recorded_at"]
            if fault_index is not None
            else None
        )

        # Recovery is the first healthy-labeled sample after actual onset.
        recovery_index = None

        if fault_index is not None:
            labels = (
                episode["scenario_label"]
                .astype(str)
                .str.strip()
                .str.lower()
            )

            recovery_candidates = episode.index[
                (episode.index > fault_index)
                & (labels == "normal")
                & (episode["availability"].astype(float) > 0)
            ].tolist()

            if recovery_candidates:
                recovery_index = int(recovery_candidates[0])

        # Exclude active-fault windows; retain healthy recovery windows.
        for index in range(window_size - 1, len(episode)):
            current_row = episode.iloc[index]

            if fault_index is not None and index >= fault_index:
                if recovery_index is None or index < recovery_index:
                    continue

            start = index - window_size + 1
            window = episode.iloc[start:index + 1]

            target_label = "normal"

            if fault_time is not None:
                time_to_fault = (
                    fault_time - current_row["recorded_at"]
                )

                if pd.Timedelta(0) < time_to_fault <= horizon:
                    target_label = fault_type

            features: dict[str, float | int | str] = {
                "episode_id": int(episode_id),
                "target_label": target_label,
            }

            for column in BASE_FEATURE_COLUMNS:
                values = (
                    window[column]
                    .astype(float)
                    .to_numpy()
                )

                features[f"{column}_current"] = float(values[-1])
                features[f"{column}_mean"] = float(np.mean(values))
                features[f"{column}_max"] = float(np.max(values))
                features[f"{column}_std"] = float(np.std(values))
                features[f"{column}_slope"] = _safe_slope(
                    values.tolist()
                )

            rows.append(features)

    if not rows:
        raise ValueError(
            "No training windows were generated. "
            "Check dataset duration and window_size."
        )

    return pd.DataFrame(rows)


def prepare_dataset(
    test_size: float = 0.2,
    random_seed: int = 42,
    window_size: int = 15,
    future_horizon_minutes: int = FUTURE_HORIZON_MINUTES,
    duration_minutes: int = 60,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.Series,
    pd.Series,
]:
    """Prepare future-labeled data with a split by episode."""
    if not 0.0 < test_size < 1.0:
        raise ValueError(
            "test_size must be between 0 and 1"
        )

    data = generate_dataset(
        random_seed=random_seed,
        duration_minutes=duration_minutes,
    )

    feature_data = build_training_features(
        data,
        window_size=window_size,
        future_horizon_minutes=future_horizon_minutes,
    )

    episode_ids = (
        feature_data["episode_id"]
        .drop_duplicates()
        .to_numpy()
    )

    rng = np.random.default_rng(random_seed)

    shuffled_episode_ids = rng.permutation(episode_ids)

    test_count = max(
        1,
        int(len(shuffled_episode_ids) * test_size),
    )

    test_episode_ids = set(
        shuffled_episode_ids[:test_count]
    )

    test_mask = feature_data["episode_id"].isin(
        test_episode_ids
    )

    train_data = feature_data.loc[
        ~test_mask
    ].reset_index(drop=True)

    test_data = feature_data.loc[
        test_mask
    ].reset_index(drop=True)

    metadata_columns = {
        "episode_id",
        "target_label",
    }

    feature_columns = [
        column
        for column in feature_data.columns
        if column not in metadata_columns
    ]

    x_train = train_data[feature_columns].copy()
    x_test = test_data[feature_columns].copy()

    y_train = train_data["target_label"].copy()
    y_test = test_data["target_label"].copy()

    return (
        x_train,
        x_test,
        y_train,
        y_test,
    )