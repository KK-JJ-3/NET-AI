from __future__ import annotations

import pytest

from app.forecast_config import FORECAST_HORIZON_MINUTES
from app.risk import (
    calculate_prediction_window,
    calculate_risk,
    calculate_risk_result,
    calculate_severity,
)


@pytest.mark.parametrize(
    ("normal_probability", "expected_risk"),
    [
        (1.0, 0.0),
        (0.8, 0.2),
        (0.4, 0.6),
        (0.000001, 0.999999),
        (0.0, 1.0),
    ],
)
def test_forecast_risk_is_one_minus_normal_probability(
    normal_probability: float,
    expected_risk: float,
) -> None:
    assert calculate_risk({"normal": normal_probability}) == pytest.approx(
        expected_risk
    )


def test_forecast_risk_can_approach_one_without_rounding_or_calibration() -> None:
    risk = calculate_risk({"normal": 0.000001})

    assert risk < 1.0
    assert risk == pytest.approx(0.999999)


@pytest.mark.parametrize(
    ("risk_score", "expected_severity"),
    [
        (0.0, "low"),
        (0.399999, "low"),
        (0.4, "medium"),
        (0.6, "high"),
        (0.8, "critical"),
        (1.0, "critical"),
    ],
)
def test_severity_thresholds(
    risk_score: float,
    expected_severity: str,
) -> None:
    assert calculate_severity(risk_score) == expected_severity


def test_forecast_window_is_fixed_to_the_trained_horizon() -> None:
    assert calculate_prediction_window(0.1) == FORECAST_HORIZON_MINUTES
    assert calculate_prediction_window(0.99) == FORECAST_HORIZON_MINUTES


def test_risk_result_keeps_score_severity_and_horizon_consistent() -> None:
    result = calculate_risk_result(
        {"normal": 0.15, "congestion": 0.8, "device_failure": 0.05}
    )

    assert result.risk_score == pytest.approx(0.85)
    assert result.severity == "critical"
    assert result.predicted_window_minutes == FORECAST_HORIZON_MINUTES


def test_risk_requires_a_normal_probability() -> None:
    with pytest.raises(ValueError, match="include 'normal'"):
        calculate_risk({"congestion": 0.8})


@pytest.mark.parametrize("normal_probability", [-0.01, 1.01])
def test_risk_rejects_normal_probability_outside_unit_interval(
    normal_probability: float,
) -> None:
    with pytest.raises(ValueError, match="between 0 and 1"):
        calculate_risk({"normal": normal_probability})
