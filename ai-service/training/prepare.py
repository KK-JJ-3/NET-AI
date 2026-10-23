from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from app.forecast_config import FORECAST_HORIZON_MINUTES
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

# Backwards-compatible alias for the shared training/inference horizon.
FUTURE_HORIZON_MINUTES = FORECAST_HORIZON_MINUTES

FAULT_LABELS = {"congestion", "device_failure"}


def _safe_slope(values: list[float]) -> float:
    """Return the least-squares slope for equally spaced values."""
    if len(values) < 2:
        return 0.0

    y = np.asarray(values, dtype=float)
    x = np.arange(len(y), dtype=float)
    centered_x = x - x.mean()
    denominator = float(np.dot(centered_x, centered_x))

    if denominator == 0.0:
        return 0.0

    return float(np.dot(centered_x, y) / denominator)


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


def _rolling_feature_arrays(
    episode: pd.DataFrame,
    window_size: int,
) -> dict[str, np.ndarray]:
    """Calculate all rolling features with NumPy instead of per-window pandas work."""
    result: dict[str, np.ndarray] = {}
    slope_x = np.arange(window_size, dtype=float)
    centered_x = slope_x - slope_x.mean()
    slope_denominator = float(np.dot(centered_x, centered_x))

    for column in BASE_FEATURE_COLUMNS:
        values = episode[column].to_numpy(dtype=float, copy=False)
        windows = sliding_window_view(values, window_size)

        result[f"{column}_current"] = windows[:, -1]
        result[f"{column}_mean"] = windows.mean(axis=1)
        result[f"{column}_max"] = windows.max(axis=1)
        result[f"{column}_std"] = windows.std(axis=1)

        if window_size < 2 or slope_denominator == 0.0:
            result[f"{column}_slope"] = np.zeros(len(windows), dtype=float)
        else:
            # Equivalent to np.polyfit(x, y, 1)[0] for each window,
            # but avoids calling a polynomial solver thousands of times.
            result[f"{column}_slope"] = (
                windows @ centered_x
            ) / slope_denominator

    return result


def build_training_features(
    data: pd.DataFrame,
    window_size: int = 15,
    future_horizon_minutes: int = FUTURE_HORIZON_MINUTES,
) -> pd.DataFrame:
    """Build rolling telemetry features with future-onset labels.

    Features use only the current row and previous rows from the same episode.
    The target is a fault type if its measured onset occurs within the future
    horizon; otherwise it is normal.

    Active-fault windows are excluded because active detection is handled
    separately. Healthy recovery windows are retained and labeled normal,
    including windows whose history still contains fault telemetry.
    """
    if window_size <= 0:
        raise ValueError("window_size must be greater than 0")

    if future_horizon_minutes <= 0:
        raise ValueError("future_horizon_minutes must be greater than 0")

    required_columns = {
        "episode_id",
        "recorded_at",
        "scenario_label",
        *BASE_FEATURE_COLUMNS,
    }
    missing_columns = required_columns.difference(data.columns)

    if missing_columns:
        raise ValueError(f"Missing required columns: {sorted(missing_columns)}")

    if data.empty:
        raise ValueError("Input dataset cannot be empty")

    # Coerce invalid strings to NaN so invalid telemetry is rejected consistently.
    numeric_data = data[BASE_FEATURE_COLUMNS].apply(
        pd.to_numeric,
        errors="coerce",
    )
    missing_mask = numeric_data.isna()

    if missing_mask.any().any():
        invalid_columns = sorted(
            missing_mask.columns[missing_mask.any()].tolist()
        )
        raise ValueError(
            "Telemetry contains missing or non-numeric values in: "
            f"{invalid_columns}"
        )

    numeric_values = numeric_data.to_numpy(dtype=float)
    if not np.isfinite(numeric_values).all():
        raise ValueError("Telemetry contains NaN or infinite numeric values")

    data = data.copy()
    data[BASE_FEATURE_COLUMNS] = numeric_data
    data = data.sort_values(["episode_id", "recorded_at"]).reset_index(drop=True)

    horizon = pd.Timedelta(minutes=future_horizon_minutes)
    rows: list[dict[str, float | int | str]] = []

    for episode_id, episode in data.groupby("episode_id", sort=False):
        episode = episode.sort_values("recorded_at").reset_index(drop=True)
        episode_length = len(episode)

        if episode_length < window_size:
            continue

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
            ]
            if len(recovery_candidates):
                recovery_index = int(recovery_candidates[0])

        # Rolling window 0 ends at row window_size - 1.
        end_indices = np.arange(window_size - 1, episode_length)
        keep_mask = np.ones(len(end_indices), dtype=bool)

        # Exclude active-fault windows; keep healthy recovery windows.
        if fault_index is not None:
            active_mask = end_indices >= fault_index
            if recovery_index is None:
                keep_mask &= ~active_mask
            else:
                keep_mask &= ~(active_mask & (end_indices < recovery_index))

        if not keep_mask.any():
            continue

        feature_arrays = _rolling_feature_arrays(episode, window_size)
        selected_positions = np.flatnonzero(keep_mask)
        selected_end_indices = end_indices[keep_mask]

        target_labels = np.full(len(selected_end_indices), "normal", dtype=object)
        if fault_time is not None:
            current_times = episode.loc[selected_end_indices, "recorded_at"]
            time_to_fault = fault_time - current_times
            forecast_mask = (time_to_fault > pd.Timedelta(0)) & (time_to_fault <= horizon)
            target_labels[forecast_mask.to_numpy()] = fault_type

        # Build records from precomputed NumPy arrays, avoiding repeated .iloc,
        # window DataFrames, and np.polyfit calls for every single sample.
        for position, target_label in zip(selected_positions, target_labels):
            record: dict[str, float | int | str | bool] = {
                "episode_id": int(episode_id),
                "target_label": str(target_label),
                # Baselines must represent stable healthy scenarios only.
                # Do not include pre-fault drift or post-fault recovery.
                "baseline_eligible": fault_type == "normal",
            }
            for feature_name, values in feature_arrays.items():
                record[feature_name] = float(values[position])
            rows.append(record)

    if not rows:
        raise ValueError(
            "No training windows were generated. Check dataset duration and window_size."
        )

    return pd.DataFrame(rows)


def prepare_dataset(
    test_size: float = 0.2,
    random_seed: int = 42,
    window_size: int = 15,
    future_horizon_minutes: int = FUTURE_HORIZON_MINUTES,
    duration_minutes: int = 60,
    episodes_per_class: int = 100,
    return_baseline_mask: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series] | tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, pd.Series]:
    """Prepare future-labeled data with a split by episode.

    ``episodes_per_class`` controls how many independent synthetic episodes
    are generated for each target scenario. The split is performed by episode
    ID so windows from the same episode cannot leak into both sets.
    """
    if not 0.0 < test_size < 1.0:
        raise ValueError("test_size must be between 0 and 1")

    if episodes_per_class <= 0:
        raise ValueError("episodes_per_class must be greater than 0")

    data = generate_dataset(
        episodes_per_class=episodes_per_class,
        random_seed=random_seed,
        duration_minutes=duration_minutes,
    )

    feature_data = build_training_features(
        data,
        window_size=window_size,
        future_horizon_minutes=future_horizon_minutes,
    )

    episode_ids = feature_data["episode_id"].drop_duplicates().to_numpy()
    rng = np.random.default_rng(random_seed)
    shuffled_episode_ids = rng.permutation(episode_ids)
    test_count = max(1, int(len(shuffled_episode_ids) * test_size))
    test_episode_ids = set(shuffled_episode_ids[:test_count])
    test_mask = feature_data["episode_id"].isin(test_episode_ids)

    train_data = feature_data.loc[~test_mask].reset_index(drop=True)
    test_data = feature_data.loc[test_mask].reset_index(drop=True)

    metadata_columns = {"episode_id", "target_label", "baseline_eligible"}
    feature_columns = [
        column for column in feature_data.columns
        if column not in metadata_columns
    ]

    x_train = train_data[feature_columns].copy()
    x_test = test_data[feature_columns].copy()
    y_train = train_data["target_label"].copy()
    y_test = test_data["target_label"].copy()

    if return_baseline_mask:
        baseline_mask = train_data["baseline_eligible"].astype(bool).reset_index(drop=True)
        return x_train, x_test, y_train, y_test, baseline_mask

    return x_train, x_test, y_train, y_test
