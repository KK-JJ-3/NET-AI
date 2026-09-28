from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)

from app.models.classifier import FaultClassifier
from training.anomaly_features import (
    prepare_features_with_anomaly,
)


def train_and_evaluate() -> FaultClassifier:
    (
        x_train,
        x_test,
        y_train,
        y_test,
    ) = prepare_features_with_anomaly()

    train_array = x_train.to_numpy(dtype=float)
    test_array = x_test.to_numpy(dtype=float)

    train_labels = y_train.to_numpy()
    test_labels = y_test.to_numpy()

    classifier = FaultClassifier(
        n_estimators=200,
        max_depth=10,
        random_state=42,
    )

    classifier.fit(
        train_array,
        train_labels,
    )

    predictions = classifier.predict(
        test_array
    )

    print("=== Random Forest Evaluation ===")
    print()
    print(
        classification_report(
            test_labels,
            predictions,
            labels=[
                "normal",
                "congestion",
                "device_failure",
            ],
            zero_division=0,
        )
    )

    print("=== Confusion Matrix ===")
    print(
        confusion_matrix(
            test_labels,
            predictions,
            labels=[
                "normal",
                "congestion",
                "device_failure",
            ],
        )
    )

    precision, recall, f1, _ = (
        precision_recall_fscore_support(
            test_labels,
            predictions,
            labels=[
                "normal",
                "congestion",
                "device_failure",
            ],
            zero_division=0,
        )
    )

    print()
    print("=== Per-Class Metrics ===")

    classes = [
        "normal",
        "congestion",
        "device_failure",
    ]

    for index, class_name in enumerate(classes):
        print(
            f"{class_name}: "
            f"precision={precision[index]:.4f}, "
            f"recall={recall[index]:.4f}, "
            f"f1={f1[index]:.4f}"
        )

    # False-positive rate for the normal class:
    #
    # Actual normal samples predicted as a fault
    # divided by all actual normal samples.
    normal_mask = test_labels == "normal"

    normal_false_positives = np.sum(
        predictions[normal_mask] != "normal"
    )

    normal_total = np.sum(normal_mask)

    normal_false_positive_rate = (
        normal_false_positives / normal_total
        if normal_total > 0
        else 0.0
    )

    print()
    print(
        "Normal false-positive rate: "
        f"{normal_false_positive_rate:.4f}"
    )

    print()
    print("=== Feature Importance ===")

    feature_importance = sorted(
        zip(
            x_train.columns,
            classifier.model.feature_importances_,
        ),
        key=lambda item: item[1],
        reverse=True,
    )

    for feature_name, importance in feature_importance[:10]:
        print(
            f"{feature_name}: "
            f"{importance:.6f}"
        )

    return classifier


if __name__ == "__main__":
    train_and_evaluate()