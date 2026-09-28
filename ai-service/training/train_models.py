from __future__ import annotations

from pathlib import Path

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from training.anomaly_features import prepare_features_with_anomaly


MODEL_DIR = (
    Path(__file__).resolve().parent.parent / "models"
)

ANOMALY_MODEL_PATH = (
    MODEL_DIR / "isolation_forest.joblib"
)

CLASSIFIER_MODEL_PATH = (
    MODEL_DIR / "random_forest.joblib"
)

FEATURE_IMPORTANCE_PATH = (
    MODEL_DIR / "feature_importance.json"
)


def train_models() -> None:
    """
    Train the Isolation Forest and Random Forest models
    using the same leakage-safe dataset preparation
    used during evaluation.
    """

    (
        x_train,
        x_test,
        y_train,
        y_test,
    ) = prepare_features_with_anomaly()

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    anomaly_detector = AnomalyDetector(
        contamination=0.05,
        random_state=42,
    )

    # The anomaly feature preparation already trains
    # an Isolation Forest internally. This separate
    # detector is trained here so it can be persisted
    # for inference.
    anomaly_detector.fit(
        x_train.drop(
            columns=["anomaly_score"]
        ).to_numpy(dtype=float)
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

    anomaly_detector.save(
        ANOMALY_MODEL_PATH
    )

    classifier.save(
        CLASSIFIER_MODEL_PATH
    )

    import json

    feature_names = list(
        x_train.columns
    )

    importances = classifier.feature_importances()

    feature_importance = {
        name: float(importance)
        for name, importance in zip(
            feature_names,
            importances,
        )
    }

    FEATURE_IMPORTANCE_PATH.write_text(
        json.dumps(
            feature_importance,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("Models trained successfully.")
    print()
    print(
        "Anomaly model:",
        ANOMALY_MODEL_PATH,
    )
    print(
        "Classifier model:",
        CLASSIFIER_MODEL_PATH,
    )
    print(
        "Feature importance:",
        FEATURE_IMPORTANCE_PATH,
    )
    print()
    print(
        "Training samples:",
        len(x_train),
    )
    print(
        "Test samples:",
        len(x_test),
    )
    print(
        "Feature count:",
        len(feature_names),
    )


if __name__ == "__main__":
    train_models()