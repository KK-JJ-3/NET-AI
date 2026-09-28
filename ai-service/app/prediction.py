from __future__ import annotations

from dataclasses import dataclass

from app.risk import calculate_risk_result


FAULT_TYPES = (
    "congestion",
    "device_failure",
)


@dataclass(frozen=True)
class PredictionResult:
    fault_type: str
    risk_score: float
    severity: str
    predicted_window_minutes: int


def select_fault_type(
    probabilities: dict[str, float],
) -> str:
    """
    Select the highest-probability non-normal fault type.
    """

    available_faults = {
        fault_type: probabilities.get(
            fault_type,
            0.0,
        )
        for fault_type in FAULT_TYPES
    }

    if not available_faults:
        raise ValueError(
            "No fault probabilities were provided"
        )

    return max(
        available_faults,
        key=available_faults.get,
    )


def build_prediction(
    probabilities: dict[str, float],
) -> PredictionResult:
    """
    Convert classifier probabilities into a prediction result.
    """

    required_classes = {
        "normal",
        "congestion",
        "device_failure",
    }

    missing_classes = (
        required_classes
        - probabilities.keys()
    )

    if missing_classes:
        raise ValueError(
            "Missing classifier probabilities: "
            f"{sorted(missing_classes)}"
        )

    for class_name, probability in probabilities.items():
        if not 0.0 <= probability <= 1.0:
            raise ValueError(
                f"Invalid probability for "
                f"{class_name}: {probability}"
            )

    fault_type = select_fault_type(
        probabilities
    )

    risk_result = calculate_risk_result(
        probabilities
    )

    return PredictionResult(
        fault_type=fault_type,
        risk_score=risk_result.risk_score,
        severity=risk_result.severity,
        predicted_window_minutes=(
            risk_result.predicted_window_minutes
        ),
    )