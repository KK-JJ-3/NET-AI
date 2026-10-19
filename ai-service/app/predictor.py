
from __future__ import annotations

import numpy as np

from app.explanation import (
    build_explanation,
    select_contributors,
)
from app.features import BASE_FEATURE_FIELDS, build_features
from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.prediction import build_prediction
from app.risk import FORECAST_HORIZON_MINUTES
from app.schemas import PredictResponse, TelemetryPoint


class FaultPredictor:
    """
    Detect active network faults and forecast future faults.

    Prediction order:
    1. Detect an active device failure.
    2. Detect active congestion using telemetry thresholds.
    3. Otherwise, forecast future faults using the trained classifier.
    """

    MIN_WINDOW_SIZE = 15

    # Keep these thresholds consistent with training/fault_thresholds.py.
    CONGESTION_UTILIZATION_THRESHOLD = 90.0
    CONGESTION_LATENCY_THRESHOLD = 100.0

    def __init__(
        self,
        anomaly_detector: AnomalyDetector,
        classifier: FaultClassifier,
        feature_importance: dict[str, float],
        normal_baseline: dict[str, float],
    ) -> None:
        self.anomaly_detector = anomaly_detector
        self.classifier = classifier
        self.feature_importance = feature_importance
        self.normal_baseline = normal_baseline

    def predict(
        self,
        window: list[TelemetryPoint],
    ) -> PredictResponse:
        """Detect active faults or forecast future faults."""

        if len(window) < self.MIN_WINDOW_SIZE:
            raise ValueError(
                f"Telemetry window must contain at least "
                f"{self.MIN_WINDOW_SIZE} points"
            )

        # Ensure all processing uses chronological order.
        ordered_window = sorted(
            window,
            key=lambda point: point.recorded_at,
        )
        for index, point in enumerate(ordered_window):
            for field in BASE_FEATURE_FIELDS:
                value = getattr(point, field)

                if value is None:
                    raise ValueError(
                        f"Telemetry point {index} has missing "
                        f"'{field}'"
                    )

                if not np.isfinite(value):
                    raise ValueError(
                        f"Telemetry point {index} has non-finite "
                        f"'{field}'"
                    )

        latest = ordered_window[-1]

        # --------------------------------------------------
        # 1. Detect an active device failure.
        # --------------------------------------------------
        latest_points = ordered_window[-2:]

        device_unavailable = all(
            point.availability is not None
            and point.availability == 0
            for point in latest_points
        )

        if device_unavailable:
            return PredictResponse(
                faultType="device_failure",
                riskScore=1.0,
                predictedWindowMinutes=(
                    FORECAST_HORIZON_MINUTES
                ),
                contributingFeatures={
                    "availability_current": 0.0,
                },
                explanationText=(
                    "[ACTIVE_FAULT_DETECTION] An active device failure is indicated by "
                    "two consecutive telemetry readings reporting "
                    "the device as unavailable. Immediate "
                    "investigation is recommended."
                ),
            )

        # --------------------------------------------------
        # 2. Detect active congestion.
        # --------------------------------------------------
        # This rule detects an existing threshold-defined fault.
        # It is separate from the classifier's future forecast.
        active_congestion = (
            latest.availability is not None
            and latest.availability > 0
            and latest.utilization_pct is not None
            and latest.latency_ms is not None
            and latest.utilization_pct
            >= self.CONGESTION_UTILIZATION_THRESHOLD
            and latest.latency_ms
            >= self.CONGESTION_LATENCY_THRESHOLD
        )

        if active_congestion:
            return PredictResponse(
                faultType="congestion",
                riskScore=1.0,
                predictedWindowMinutes=(
                    FORECAST_HORIZON_MINUTES
                ),
                contributingFeatures={
                    "utilization_pct_current": float(
                        latest.utilization_pct
                    ),
                    "latency_ms_current": float(
                        latest.latency_ms
                    ),
                },
                explanationText=(
                    "[ACTIVE_FAULT_DETECTION] Active network congestion is indicated by "
                    "network utilization at or above "
                    f"{self.CONGESTION_UTILIZATION_THRESHOLD:.0f}% "
                    "and latency at or above "
                    f"{self.CONGESTION_LATENCY_THRESHOLD:.0f} ms. "
                    "Immediate investigation is recommended."
                ),
            )

        # --------------------------------------------------
        # 3. Extract the base features used during training.
        # --------------------------------------------------
        feature_dict = build_features(ordered_window)
        feature_names = list(feature_dict.keys())

        feature_array = np.asarray(
            [
                feature_dict[name]
                for name in feature_names
            ],
            dtype=float,
        ).reshape(1, -1)

        if not np.isfinite(feature_array).all():
            raise ValueError(
                "Extracted telemetry features contain "
                "NaN or infinite values"
            )

        # --------------------------------------------------
        # 4. Calculate the anomaly score.
        # --------------------------------------------------
        anomaly_scores = self.anomaly_detector.anomaly_score(
            feature_array
        )

        anomaly_score = float(anomaly_scores[0])

        if not np.isfinite(anomaly_score):
            raise ValueError(
                "Anomaly detector returned a non-finite score"
            )

        feature_dict["anomaly_score"] = anomaly_score

        # The classifier expects the base features followed by
        # the anomaly score, matching the training feature order.
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

        if not np.isfinite(classifier_array).all():
            raise ValueError(
                "Classifier input contains NaN or infinite values"
            )

        # --------------------------------------------------
        # 5. Predict future faults using the trained classifier.
        # --------------------------------------------------
        probabilities_array = self.classifier.predict_proba(
            classifier_array
        )[0]

        classes = self.classifier.classes()

        probabilities = {
            str(class_name): float(probability)
            for class_name, probability in zip(
                classes,
                probabilities_array,
            )
        }

        prediction = build_prediction(probabilities)

        # --------------------------------------------------
        # 6. Explain the prediction.
        # --------------------------------------------------
        contributors = select_contributors(
            feature_importance=self.feature_importance,
            current_features=feature_dict,
            top_n=3,
            normal_baseline=self.normal_baseline,
        )

        contributing_features = {
            contributor.name: float(contributor.importance)
            for contributor in contributors
        }

        if prediction.is_normal:
            explanation = (
                "No significant future fault risk is indicated "
                "by the current telemetry window. "
                "This does not guarantee that a fault cannot occur."
            )
        else:
            explanation = build_explanation(
                fault_type=prediction.fault_type,
                contributors=contributors,
                risk_score=prediction.risk_score,
            )

            explanation = (
                f"Forecast horizon: "
                f"{FORECAST_HORIZON_MINUTES} minutes. "
                f"{explanation}"
            )

        # --------------------------------------------------
        # 7. Return the prediction.
        # --------------------------------------------------
        return PredictResponse(
            faultType=prediction.fault_type,
            riskScore=prediction.risk_score,
            predictedWindowMinutes=(
                FORECAST_HORIZON_MINUTES
            ),
            contributingFeatures=contributing_features,
            explanationText=explanation,
        )
