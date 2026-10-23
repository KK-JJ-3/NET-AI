"""Shared forecast configuration used by training and inference."""

# Predict whether a fault will begin within this many minutes.
# Changing this value requires retraining the saved models.
FORECAST_HORIZON_MINUTES = 20
