from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RiskResult:
    risk_score: float
    severity: str
    predicted_window_minutes: int


def calculate_risk(
    probabilities: dict[str, float],
) -> float:
    """
    Calculate fault risk as 1 - probability of normal operation.
    """

    normal_probability = probabilities.get(
        "normal",
        0.0,
    )

    risk_score = 1.0 - normal_probability

    return max(
        0.0,
        min(
            1.0,
            risk_score,
        ),
    )


def calculate_severity(
    risk_score: float,
) -> str:
    """Map risk score to the project's severity levels."""

    if not 0.0 <= risk_score <= 1.0:
        raise ValueError(
            "risk_score must be between 0 and 1"
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
    Convert risk into the prediction window used by the system.

    Higher risk gets a shorter, more immediate prediction window.
    """

    if not 0.0 <= risk_score <= 1.0:
        raise ValueError(
            "risk_score must be between 0 and 1"
        )

    if risk_score >= 0.8:
        return 10

    return 30


def calculate_risk_result(
    probabilities: dict[str, float],
) -> RiskResult:
    """Calculate risk, severity, and prediction window together."""

    risk_score = calculate_risk(
        probabilities
    )

    severity = calculate_severity(
        risk_score
    )

    predicted_window_minutes = (
        calculate_prediction_window(
            risk_score
        )
    )

    return RiskResult(
        risk_score=risk_score,
        severity=severity,
        predicted_window_minutes=(
            predicted_window_minutes
        ),
    )