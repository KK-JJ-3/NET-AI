
from __future__ import annotations

from dataclasses import dataclass
import math

from app.risk import calculate_risk_result


CLASS_NAMES = (
    "normal",
    "congestion",
    "device_failure",
)

FAULT_CLASSES = (
    "congestion",
    "device_failure",
)

# Keep aligned with the severity thresholds in app/risk.py.
FAULT_RISK_THRESHOLD = 0.4
PROBABILITY_SUM_TOLERANCE = 0.02


@dataclass(frozen=True)
class PredictionResult:
    fault_type: str
    risk_score: float
    severity: str
    predicted_window_minutes: int
    is_normal: bool


def _validate_probabilities(
    probabilities: dict[str, float],
) -> None:
    """Validate class probabilities returned by the classifier."""

    missing_classes = set(CLASS_NAMES) - probabilities.keys()

    if missing_classes:
        raise ValueError(
            "Missing classifier probabilities: "
            f"{sorted(missing_classes)}"
        )

    for class_name in CLASS_NAMES:
        probability = probabilities[class_name]

        if not math.isfinite(probability):
            raise ValueError(
                f"Probability for {class_name} must be finite."
            )

        if not 0.0 <= probability <= 1.0:
            raise ValueError(
                f"Invalid probability for {class_name}: "
                f"{probability}"
            )

    probability_sum = sum(
        probabilities[class_name]
        for class_name in CLASS_NAMES
    )

    if abs(probability_sum - 1.0) > PROBABILITY_SUM_TOLERANCE:
        raise ValueError(
            "Classifier probabilities must sum to approximately 1.0; "
            f"received {probability_sum:.6f}."
        )


def select_fault_type(
    probabilities: dict[str, float],
) -> str:
    """
    Select the outcome for the forecast horizon.

    A low combined fault risk is classified as normal.
    At medium risk or above, return the most probable fault class,
    even when its individual probability is lower than P(normal).
    """
    _validate_probabilities(probabilities)

    risk_result = calculate_risk_result(probabilities)

    if risk_result.risk_score < FAULT_RISK_THRESHOLD:
        return "normal"

    return max(
        FAULT_CLASSES,
        key=lambda class_name: probabilities[class_name],
    )


def build_prediction(
    probabilities: dict[str, float],
) -> PredictionResult:
    """Convert classifier probabilities into a forecast result."""

    _validate_probabilities(probabilities)

    risk_result = calculate_risk_result(probabilities)

    if risk_result.risk_score < FAULT_RISK_THRESHOLD:
        selected_class = "normal"
    else:
        selected_class = max(
            FAULT_CLASSES,
            key=lambda class_name: probabilities[class_name],
        )

    return PredictionResult(
        fault_type=selected_class,
        risk_score=risk_result.risk_score,
        severity=risk_result.severity,
        predicted_window_minutes=(
            risk_result.predicted_window_minutes
        ),
        is_normal=(selected_class == "normal"),
    )
