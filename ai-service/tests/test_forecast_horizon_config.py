from app.forecast_config import FORECAST_HORIZON_MINUTES
from app.risk import calculate_prediction_window
from training.prepare import FUTURE_HORIZON_MINUTES
from training.train_models import FUTURE_HORIZON_MINUTES as TRAINING_HORIZON_MINUTES
from training.evaluate_lead_time import FORECAST_HORIZON_MINUTES as LEAD_TIME_HORIZON_MINUTES
from training.evaluate_lead_time_thresholds import FORECAST_HORIZON_MINUTES as THRESHOLD_HORIZON_MINUTES
from training.evaluate_lead_time_thresholds_multiseed import (
    FORECAST_HORIZON_MINUTES as MULTISEED_HORIZON_MINUTES,
)


def test_training_inference_and_evaluators_share_forecast_horizon():
    assert FORECAST_HORIZON_MINUTES == 20
    assert FUTURE_HORIZON_MINUTES == FORECAST_HORIZON_MINUTES
    assert TRAINING_HORIZON_MINUTES == FORECAST_HORIZON_MINUTES
    assert LEAD_TIME_HORIZON_MINUTES == FORECAST_HORIZON_MINUTES
    assert THRESHOLD_HORIZON_MINUTES == FORECAST_HORIZON_MINUTES
    assert MULTISEED_HORIZON_MINUTES == FORECAST_HORIZON_MINUTES


def test_prediction_reports_the_horizon_used_for_training():
    assert calculate_prediction_window(0.5) == FORECAST_HORIZON_MINUTES
