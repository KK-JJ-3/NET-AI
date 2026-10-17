
from __future__ import annotations

from dataclasses import dataclass


# This must match the horizon used by training/prepare.py
# and training/train_models.py.
FORECAST_HORIZON_MINUTES = 30


@dataclass(frozen=True)
class RiskResult:
    risk_score: float
    severity: str
    predicted_window_minutes: int


def calculate_risk(
    probabilities: dict[str, float],
) -> float:
    """
    Calculate the probability of a future fault within the
    trained forecast horizon.

    Risk = 1 - P(normal).
    """
    normal_probability = probabilities.get("normal")

    if normal_probability is None:
        raise ValueError(
            "Classifier probabilities must include 'normal'."
        )

    if not 0.0 <= normal_probability <= 1.0:
        raise ValueError(
            "Normal probability must be between 0 and 1."
        )

    return 1.0 - normal_probability


def calculate_severity(
    risk_score: float,
) -> str:
    """Map the predicted future-fault risk to severity."""

    if not 0.0 <= risk_score <= 1.0:
        raise ValueError(
            "risk_score must be between 0 and 1."
        )

    if risk_score >= 0.8:
        return "critical"

    if risk_score >= 0.6:
        return "high"

    if risk_score >= 0.4:
        return "medium"

    return "low"


def calculate_prediction_window(
    risk_score: float,
) -> int:
    """
    Return the forecast horizon used during model training.

    Risk determines severity, not the forecast duration.
    """
    if not 0.0 <= risk_score <= 1.0:
        raise ValueError(
            "risk_score must be between 0 and 1."
        )

    return FORECAST_HORIZON_MINUTES


def calculate_risk_result(
    probabilities: dict[str, float],
) -> RiskResult:
    """Calculate risk, severity, and forecast horizon."""

    risk_score = calculate_risk(probabilities)

    return RiskResult(
        risk_score=risk_score,
        severity=calculate_severity(risk_score),
        predicted_window_minutes=calculate_prediction_window(
            risk_score
        ),
    )
