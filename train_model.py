"""
Train Network Fault Detection Models.

Stage 1:
    Binary prediction
    Future fault within 5 minutes

Stage 2:
    Fault type classification

Run:
    python train_model.py
"""

import os
import pickle

import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (
    classification_report,
    f1_score
)

from xgboost import XGBClassifier


BASE_DIR = os.path.dirname(__file__)

DATA_PATH = os.path.join(
    BASE_DIR,
    "data",
    "simulated_network_data.csv"
)

MODEL_DIR = os.path.join(
    BASE_DIR,
    "models"
)

os.makedirs(
    MODEL_DIR,
    exist_ok=True
)


# -----------------------------------
# Features
# -----------------------------------

FEATURES = [

    "latency_ms",

    "packet_loss_pct",

    "bandwidth_utilization_pct",

    "cpu_utilization_pct",

    "memory_utilization_pct",

    "throughput_mbps",

    "jitter_ms",

    "error_rate",

    "active_connections",

    "temperature_c",

    "signal_strength_pct"
]


# -----------------------------------
# Load data
# -----------------------------------

df = pd.read_csv(DATA_PATH)

print(
    f"Dataset shape: {df.shape}"
)


X = df[FEATURES]

y_binary = df[
    "future_fault_5min"
]


# ===================================
# MODEL 1
# Binary Fault Prediction
# ===================================

X_train, X_test, y_train, y_test = train_test_split(

    X,

    y_binary,

    test_size=0.20,

    random_state=42,

    stratify=y_binary
)


binary_model = XGBClassifier(

    n_estimators=250,

    max_depth=5,

    learning_rate=0.05,

    subsample=0.85,

    colsample_bytree=0.85,

    objective="binary:logistic",

    eval_metric="logloss",

    random_state=42
)


print("\nTraining binary model...")

binary_model.fit(
    X_train,
    y_train
)


predictions = binary_model.predict(
    X_test
)


print(
    "\n===== BINARY MODEL ====="
)

print(
    classification_report(
        y_test,
        predictions
    )
)

print(
    "F1 Score:",
    f1_score(
        y_test,
        predictions
    )
)


# ===================================
# MODEL 2
# Fault Type Classification
# ===================================

fault_df = df[
    df["fault_type"] != "normal"
].copy()


label_encoder = LabelEncoder()


fault_df["fault_encoded"] = (
    label_encoder.fit_transform(
        fault_df["fault_type"]
    )
)


X_fault = fault_df[
    FEATURES
]

y_fault = fault_df[
    "fault_encoded"
]


X_train2, X_test2, y_train2, y_test2 = train_test_split(

    X_fault,

    y_fault,

    test_size=0.20,

    random_state=42,

    stratify=y_fault
)


type_model = XGBClassifier(

    n_estimators=300,

    max_depth=6,

    learning_rate=0.05,

    subsample=0.85,

    colsample_bytree=0.85,

    objective="multi:softprob",

    eval_metric="mlogloss",

    num_class=len(
        label_encoder.classes_
    ),

    random_state=42
)


print(
    "\nTraining fault type model..."
)


type_model.fit(
    X_train2,
    y_train2
)


type_predictions = type_model.predict(
    X_test2
)


print(
    "\n===== FAULT TYPE MODEL ====="
)


print(
    classification_report(
        y_test2,
        type_predictions,
        target_names=label_encoder.classes_
    )
)


print(
    "Macro F1:",
    f1_score(
        y_test2,
        type_predictions,
        average="macro"
    )
)


# ===================================
# Save models
# ===================================

models = {

    "fault_binary_xgb.pkl":
        binary_model,

    "fault_type_xgb.pkl":
        type_model,

    "label_encoder.pkl":
        label_encoder,

    "feature_columns.pkl":
        FEATURES
}


for filename, model in models.items():

    path = os.path.join(
        MODEL_DIR,
        filename
    )

    with open(
        path,
        "wb"
    ) as file:

        pickle.dump(
            model,
            file
        )

    print(
        f"Saved: {path}"
    )


print(
    "\nTraining complete!"
)