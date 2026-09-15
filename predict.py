"""
Live Network Fault Predictor.

This takes network telemetry and returns:

- Fault detected
- Fault probability
- Fault type
- Type confidence
- Severity score
- Severity level
- Time-to-fault status
"""

import os
import pickle

import numpy as np
import pandas as pd


BASE_DIR = os.path.dirname(__file__)

MODEL_DIR = os.path.join(
    BASE_DIR,
    "models"
)


# -----------------------------------
# Load models
# -----------------------------------

with open(
    os.path.join(
        MODEL_DIR,
        "fault_binary_xgb.pkl"
    ),
    "rb"
) as file:

    binary_model = pickle.load(file)


with open(
    os.path.join(
        MODEL_DIR,
        "fault_type_xgb.pkl"
    ),
    "rb"
) as file:

    type_model = pickle.load(file)


with open(
    os.path.join(
        MODEL_DIR,
        "label_encoder.pkl"
    ),
    "rb"
) as file:

    label_encoder = pickle.load(file)


with open(
    os.path.join(
        MODEL_DIR,
        "feature_columns.pkl"
    ),
    "rb"
) as file:

    FEATURES = pickle.load(file)


# -----------------------------------
# Severity
# -----------------------------------

def get_severity(score):

    if score < 25:
        return "Low"

    elif score < 50:
        return "Medium"

    elif score < 75:
        return "High"

    else:
        return "Critical"


# -----------------------------------
# Prediction
# -----------------------------------

def predict(telemetry):

    X = pd.DataFrame(
        [telemetry]
    )[FEATURES]


    # ================================
    # Fault probability
    # ================================

    fault_probability = float(

        binary_model
        .predict_proba(X)[0][1]

    )


    fault_probability_pct = (
        fault_probability * 100
    )


    # ================================
    # Fault type
    # ================================

    if fault_probability < 0.50:

        fault_type = "normal"

        type_confidence = (
            1 - fault_probability
        )

    else:

        probabilities = (
            type_model
            .predict_proba(X)[0]
        )

        best_index = int(
            np.argmax(probabilities)
        )

        fault_type = (
            label_encoder
            .inverse_transform(
                [best_index]
            )[0]
        )

        type_confidence = float(
            probabilities[best_index]
        )


    # ================================
    # Severity score
    # ================================

    latency_score = min(
        telemetry["latency_ms"] / 300 * 100,
        100
    )

    packet_loss_score = min(
        telemetry["packet_loss_pct"] / 20 * 100,
        100
    )

    cpu_score = (
        telemetry["cpu_utilization_pct"]
    )

    error_score = min(
        telemetry["error_rate"] / 50 * 100,
        100
    )

    temperature_score = min(
        telemetry["temperature_c"] / 90 * 100,
        100
    )


    severity_score = (

        0.35 * latency_score

        + 0.25 * packet_loss_score

        + 0.20 * cpu_score

        + 0.10 * error_score

        + 0.10 * temperature_score
    )


    severity_score = round(
        min(severity_score, 100),
        1
    )


    # ================================
    # Time to fault
    # ================================

    if fault_probability >= 0.75:

        time_to_fault = (
            "Immediate / Ongoing"
        )

    elif fault_probability >= 0.50:

        time_to_fault = (
            "Likely within 5 minutes"
        )

    else:

        time_to_fault = (
            "No immediate fault"
        )


    # ================================
    # Final output
    # ================================

    return {

        "fault_detected":
            fault_probability >= 0.50,

        "fault_probability_pct":
            round(
                fault_probability_pct,
                2
            ),

        "fault_type":
            fault_type,

        "type_confidence_pct":
            round(
                type_confidence * 100,
                2
            ),

        "severity_score":
            severity_score,

        "severity":
            get_severity(
                severity_score
            ),

        "time_to_fault":
            time_to_fault
    }


# ===================================
# TEST
# ===================================

if __name__ == "__main__":

    sample_network = {

        "latency_ms": 180,

        "packet_loss_pct": 12,

        "bandwidth_utilization_pct": 96,

        "cpu_utilization_pct": 91,

        "memory_utilization_pct": 70,

        "throughput_mbps": 95,

        "jitter_ms": 35,

        "error_rate": 28,

        "active_connections": 2500,

        "temperature_c": 68,

        "signal_strength_pct": 62
    }


    result = predict(
        sample_network
    )


    print(
        "\n===== NETWORK AI PREDICTION ====="
    )


    for key, value in result.items():

        print(
            f"{key}: {value}"
        )