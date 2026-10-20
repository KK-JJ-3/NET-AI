from training.evaluate_lead_time import is_horizon_valid


def test_onset_inside_returned_prediction_horizon_is_valid():
    assert is_horizon_valid(25, 20, predicted_window_minutes=5)
    assert is_horizon_valid(30, 20, predicted_window_minutes=10)


def test_short_returned_horizon_is_not_replaced_by_configured_ten_minutes():
    assert not is_horizon_valid(26, 20, predicted_window_minutes=5)


def test_onset_must_be_strictly_after_prediction_timestamp():
    assert not is_horizon_valid(20, 20, predicted_window_minutes=10)
    assert not is_horizon_valid(19, 20, predicted_window_minutes=10)


def test_horizon_boundary_is_inclusive():
    assert is_horizon_valid(25, 20, predicted_window_minutes=5, interval_seconds=60)
    assert not is_horizon_valid(26, 20, predicted_window_minutes=5, interval_seconds=60)


def test_invalid_horizon_or_interval_is_rejected():
    assert not is_horizon_valid(25, 20, predicted_window_minutes=0)
    assert not is_horizon_valid(25, 20, predicted_window_minutes=5, interval_seconds=0)
