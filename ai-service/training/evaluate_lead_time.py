from __future__ import annotations

import numpy as np
import pandas as pd

from app.models.classifier import FaultClassifier
from simulator.dataset import generate_dataset
from training.anomaly_features import add_anomaly_feature
from training.fault_thresholds import find_fault_index
from training.prepare import build_training_features


FAULT_CLASSES = {
    "congestion",
    "device_failure",
}


def get_train_test_episode_ids(
    data: pd.DataFrame,
) -> tuple[set[int], set[int]]:
    """Create a reproducible episode-based train/test split."""

    episode_ids = (
        data["episode_id"]
        .drop_duplicates()
        .to_numpy()
    )

    rng = np.random.default_rng(42)

    shuffled_ids = rng.permutation(
        episode_ids
    )

    test_count = max(
        1,
        int(len(shuffled_ids) * 0.2),
    )

    test_episode_ids = set(
        shuffled_ids[:test_count]
    )

    train_episode_ids = set(
        shuffled_ids[test_count:]
    )

    return (
        train_episode_ids,
        test_episode_ids,
    )


def train_classifier(
    data: pd.DataFrame,
    train_episode_ids: set[int],
    test_episode_ids: set[int],
) -> FaultClassifier:
    """Train the classifier using only training episodes."""

    train_data = data[
        data["episode_id"].isin(
            train_episode_ids
        )
    ].reset_index(drop=True)

    test_data = data[
        data["episode_id"].isin(
            test_episode_ids
        )
    ].reset_index(drop=True)

    train_features = build_training_features(
        train_data
    )

    test_features = build_training_features(
        test_data
    )

    feature_columns = [
        column
        for column in train_features.columns
        if column not in {
            "episode_id",
            "scenario_label",
        }
    ]

    x_train = train_features[
        feature_columns
    ].copy()

    x_test = test_features[
        feature_columns
    ].copy()

    y_train = train_features[
        "scenario_label"
    ].copy()

    x_train, x_test = add_anomaly_feature(
        x_train,
        x_test,
    )

    classifier = FaultClassifier(
        n_estimators=200,
        max_depth=10,
        random_state=42,
    )

    classifier.fit(
        x_train.to_numpy(dtype=float),
        y_train.to_numpy(),
    )

    return classifier


def evaluate_lead_time() -> None:
    """Evaluate whether faults are predicted before their onset."""

    data = generate_dataset()

    (
        train_episode_ids,
        test_episode_ids,
    ) = get_train_test_episode_ids(data)

    test_data = data[
        data["episode_id"].isin(
            test_episode_ids
        )
    ].copy()

    classifier = train_classifier(
        data=data,
        train_episode_ids=train_episode_ids,
        test_episode_ids=test_episode_ids,
    )

    results: list[dict[str, object]] = []

    for episode_id, episode in test_data.groupby(
        "episode_id",
        sort=True,
    ):
        episode = episode.sort_values(
            "recorded_at"
        ).reset_index(drop=True)

        scenario = episode.loc[
            0,
            "scenario_label",
        ]

        if scenario not in FAULT_CLASSES:
            continue

        features = build_training_features(
            episode
        )

        feature_columns = [
            column
            for column in features.columns
            if column not in {
                "episode_id",
                "scenario_label",
            }
        ]

        train_data = data[
            data["episode_id"].isin(
                train_episode_ids
            )
        ].reset_index(drop=True)

        train_features = build_training_features(
            train_data
        )

        train_x = train_features[
            feature_columns
        ].copy()

        test_x = features[
            feature_columns
        ].copy()

        train_x, test_x = add_anomaly_feature(
            train_x,
            test_x,
        )

        predictions = classifier.predict(
            test_x.to_numpy(dtype=float)
        )

        actual_fault_index = find_fault_index(
            episode,
            scenario,
        )

        if actual_fault_index is None:
            continue

        first_correct_prediction_index = None

        for index in range(
            actual_fault_index
        ):
            if predictions[index] == scenario:
                first_correct_prediction_index = (
                    index
                )
                break

        if first_correct_prediction_index is None:
            results.append(
                {
                    "episode_id": episode_id,
                    "scenario": scenario,
                    "lead_time_minutes": None,
                    "detected_before_fault": False,
                }
            )
            continue

        prediction_time = episode.loc[
            first_correct_prediction_index,
            "recorded_at",
        ]

        fault_time = episode.loc[
            actual_fault_index,
            "recorded_at",
        ]

        lead_time = (
            fault_time - prediction_time
        ).total_seconds() / 60.0

        results.append(
            {
                "episode_id": episode_id,
                "scenario": scenario,
                "lead_time_minutes": lead_time,
                "detected_before_fault": True,
            }
        )

    results_df = pd.DataFrame(results)

    print("=== Lead-Time Evaluation ===")
    print()

    if results_df.empty:
        print(
            "No fault episodes found in test set."
        )
        return

    print(
        results_df.to_string(
            index=False
        )
    )

    detected = results_df[
        results_df["detected_before_fault"]
    ]

    print()
    print(
        "Fault episodes evaluated:",
        len(results_df),
    )

    print(
        "Detected before fault:",
        len(detected),
    )

    detection_rate = (
        len(detected) / len(results_df)
        if len(results_df) > 0
        else 0.0
    )

    print(
        "Detection rate:",
        f"{detection_rate:.4f}",
    )

    if detected.empty:
        return

    print(
        "Mean lead time:",
        f"{detected['lead_time_minutes'].mean():.2f} minutes",
    )

    print(
        "Median lead time:",
        f"{detected['lead_time_minutes'].median():.2f} minutes",
    )

    print(
        "Minimum lead time:",
        f"{detected['lead_time_minutes'].min():.2f} minutes",
    )

    print(
        "Maximum lead time:",
        f"{detected['lead_time_minutes'].max():.2f} minutes",
    )

    episodes_with_five_minutes = int(
        (
            detected["lead_time_minutes"]
            >= 5.0
        ).sum()
    )

    print()

    print(
        "Episodes with >= 5 minute lead time:",
        episodes_with_five_minutes,
    )


if __name__ == "__main__":
    evaluate_lead_time()