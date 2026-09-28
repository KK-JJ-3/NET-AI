from __future__ import annotations

import numpy as np

from app.explanation import (
    build_explanation,
    select_contributors,
)
from app.features import build_features
from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.prediction import build_prediction
from app.schemas import PredictResponse, TelemetryPoint


class FaultPredictor:
    """
    Combines feature engineering, anomaly detection,
    classification, risk calculation, and explanation.
    """

    def __init__(
        self,
        anomaly_detector: AnomalyDetector,
        classifier: FaultClassifier,
        feature_importance: dict[str, float],
    ) -> None:
        self.anomaly_detector = anomaly_detector
        self.classifier = classifier
        self.feature_importance = feature_importance

    def predict(
        self,
        window: list[TelemetryPoint],
    ) -> PredictResponse:
        """
        Generate a complete prediction from a telemetry window.
        """

        if not window:
            raise ValueError(
                "Telemetry window cannot be empty"
            )

        feature_dict = build_features(
            window
        )

        feature_names = list(
            feature_dict.keys()
        )

        feature_array = np.asarray(
            [
                feature_dict[name]
                for name in feature_names
            ],
            dtype=float,
        ).reshape(1, -1)

        anomaly_score = (
            self.anomaly_detector.anomaly_score(
                feature_array
            )[0]
        )

        feature_dict[
            "anomaly_score"
        ] = float(anomaly_score)

        classifier_feature_names = (
            feature_names + ["anomaly_score"]
        )

        classifier_array = np.asarray(
            [
                feature_dict[name]
                for name in classifier_feature_names
            ],
            dtype=float,
        ).reshape(1, -1)

        probabilities_array = (
            self.classifier.predict_proba(
                classifier_array
            )[0]
        )

        classes = self.classifier.classes()

        probabilities = {
            str(class_name): float(
                probability
            )
            for class_name, probability in zip(
                classes,
                probabilities_array,
            )
        }

        prediction = build_prediction(
            probabilities
        )

        contributors = select_contributors(
            feature_importance=(
                self.feature_importance
            ),
            current_features=feature_dict,
            top_n=3,
        )

        explanation = build_explanation(
            fault_type=prediction.fault_type,
            contributors=contributors,
        )

        contributing_features = {
            contributor.name: contributor.importance
            for contributor in contributors
        }

        return PredictResponse(
            faultType=prediction.fault_type,
            riskScore=prediction.risk_score,
            predictedWindowMinutes=(
                prediction.predicted_window_minutes
            ),
            contributingFeatures=(
                contributing_features
            ),
            explanationText=explanation,
        )