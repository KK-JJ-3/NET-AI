from __future__ import annotations

import numpy as np
import pandas as pd

from app.models.anomaly import AnomalyDetector
from training.prepare import prepare_dataset


def add_anomaly_feature(
    x_train: pd.DataFrame,
    x_test: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Train an Isolation Forest on training data and append anomaly scores.

    The detector is fitted only on x_train so test data does not influence
    the learned anomaly model.
    """

    if x_train.empty:
        raise ValueError("Training features cannot be empty")

    if x_test.empty:
        raise ValueError("Test features cannot be empty")

    if list(x_train.columns) != list(x_test.columns):
        raise ValueError(
            "Training and test feature columns must match"
        )

    train_array = x_train.to_numpy(dtype=float)
    test_array = x_test.to_numpy(dtype=float)

    detector = AnomalyDetector(
        contamination=0.05,
        random_state=42,
    )

    detector.fit(train_array)

    train_scores = detector.anomaly_score(
        train_array
    )

    test_scores = detector.anomaly_score(
        test_array
    )

    x_train_with_anomaly = x_train.copy()
    x_test_with_anomaly = x_test.copy()

    x_train_with_anomaly[
        "anomaly_score"
    ] = train_scores

    x_test_with_anomaly[
        "anomaly_score"
    ] = test_scores

    return (
        x_train_with_anomaly,
        x_test_with_anomaly,
    )


def prepare_features_with_anomaly(
    random_seed: int = 42,
    window_size: int = 15,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.Series,
    pd.Series,
]:
    """
    Prepare engineered features and append Isolation Forest scores.
    """

    (
        x_train,
        x_test,
        y_train,
        y_test,
    ) = prepare_dataset(
        random_seed=random_seed,
        window_size=window_size,
    )

    (
        x_train_with_anomaly,
        x_test_with_anomaly,
    ) = add_anomaly_feature(
        x_train,
        x_test,
    )

    return (
        x_train_with_anomaly,
        x_test_with_anomaly,
        y_train,
        y_test,
    )