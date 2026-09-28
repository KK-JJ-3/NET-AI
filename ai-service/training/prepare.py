from __future__ import annotations

import numpy as np
import pandas as pd

from simulator.dataset import generate_dataset


BASE_FEATURE_COLUMNS = [
    "latency_ms",
    "packet_loss_pct",
    "jitter_ms",
    "utilization_pct",
    "cpu_pct",
    "memory_pct",
    "availability",
]


def _safe_slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0

    x = np.arange(len(values), dtype=float)
    y = np.asarray(values, dtype=float)

    return float(np.polyfit(x, y, 1)[0])


def build_training_features(
    data: pd.DataFrame,
    window_size: int = 15,
) -> pd.DataFrame:
    """
    Build leakage-safe rolling features.

    For every telemetry row, only the current row and previous rows
    from the same episode are used.
    """

    if window_size <= 0:
        raise ValueError(
            "window_size must be greater than 0"
        )

    required_columns = {
        "episode_id",
        "recorded_at",
        "scenario_label",
        *BASE_FEATURE_COLUMNS,
    }

    missing_columns = required_columns.difference(
        data.columns
    )

    if missing_columns:
        raise ValueError(
            f"Missing required columns: "
            f"{sorted(missing_columns)}"
        )

    data = data.sort_values(
        ["episode_id", "recorded_at"]
    ).reset_index(drop=True)

    rows: list[dict[str, float | int | str]] = []

    for episode_id, episode in data.groupby(
        "episode_id",
        sort=False,
    ):
        episode = episode.reset_index(drop=True)

        for index in range(len(episode)):
            start = max(
                0,
                index - window_size + 1,
            )

            window = episode.iloc[
                start : index + 1
            ]

            row = episode.iloc[index]

            features: dict[str, float | int | str] = {
                "episode_id": int(episode_id),
                "scenario_label": str(
                    row["scenario_label"]
                ),
            }

            for column in BASE_FEATURE_COLUMNS:
                values = (
                    window[column]
                    .astype(float)
                    .to_numpy()
                )

                features[f"{column}_current"] = float(
                    values[-1]
                )

                features[f"{column}_mean"] = float(
                    np.mean(values)
                )

                features[f"{column}_max"] = float(
                    np.max(values)
                )

                features[f"{column}_std"] = float(
                    np.std(values)
                )

                features[f"{column}_slope"] = (
                    _safe_slope(
                        values.tolist()
                    )
                )

            rows.append(features)

    return pd.DataFrame(rows)


def prepare_dataset(
    test_size: float = 0.2,
    random_seed: int = 42,
    window_size: int = 15,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.Series,
    pd.Series,
]:
    """Prepare a leakage-safe train/test split by episode."""

    if not 0.0 < test_size < 1.0:
        raise ValueError(
            "test_size must be between 0 and 1"
        )

    data = generate_dataset(
        random_seed=random_seed,
    )

    feature_data = build_training_features(
        data,
        window_size=window_size,
    )

    episode_ids = (
        feature_data["episode_id"]
        .drop_duplicates()
        .to_numpy()
    )

    rng = np.random.default_rng(random_seed)

    shuffled_episode_ids = rng.permutation(
        episode_ids
    )

    test_count = max(
        1,
        int(len(shuffled_episode_ids) * test_size),
    )

    test_episode_ids = set(
        shuffled_episode_ids[:test_count]
    )

    train_mask = ~feature_data[
        "episode_id"
    ].isin(test_episode_ids)

    test_mask = feature_data[
        "episode_id"
    ].isin(test_episode_ids)

    train_data = feature_data.loc[
        train_mask
    ].reset_index(drop=True)

    test_data = feature_data.loc[
        test_mask
    ].reset_index(drop=True)

    feature_columns = [
        column
        for column in feature_data.columns
        if column not in {
            "episode_id",
            "scenario_label",
        }
    ]

    x_train = train_data[
        feature_columns
    ].copy()

    x_test = test_data[
        feature_columns
    ].copy()

    y_train = train_data[
        "scenario_label"
    ].copy()

    y_test = test_data[
        "scenario_label"
    ].copy()

    return (
        x_train,
        x_test,
        y_train,
        y_test,
    )