from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException

from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from app.predictor import FaultPredictor
from app.schemas import PredictRequest, PredictResponse


BASE_DIR = Path(__file__).resolve().parent.parent

MODEL_DIR = BASE_DIR / "models"

ANOMALY_MODEL_PATH = (
    MODEL_DIR / "isolation_forest.joblib"
)

CLASSIFIER_MODEL_PATH = (
    MODEL_DIR / "random_forest.joblib"
)

FEATURE_IMPORTANCE_PATH = (
    MODEL_DIR / "feature_importance.json"
)


def load_predictor() -> FaultPredictor:
    """Load persisted ML models and create the predictor."""

    anomaly_detector = AnomalyDetector()

    anomaly_detector.load(
        ANOMALY_MODEL_PATH
    )

    classifier = FaultClassifier()

    classifier.load(
        CLASSIFIER_MODEL_PATH
    )

    if not FEATURE_IMPORTANCE_PATH.exists():
        raise FileNotFoundError(
            "Feature importance file not found: "
            f"{FEATURE_IMPORTANCE_PATH}"
        )

    with FEATURE_IMPORTANCE_PATH.open(
        "r",
        encoding="utf-8",
    ) as file:
        feature_importance = json.load(file)

    return FaultPredictor(
        anomaly_detector=anomaly_detector,
        classifier=classifier,
        feature_importance=feature_importance,
    )


app = FastAPI(
    title="NetFault AI Service",
    version="1.0.0",
)


predictor = load_predictor()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ai-service",
    }


@app.post(
    "/predict",
    response_model=PredictResponse,
)
def predict(
    request: PredictRequest,
):
    try:
        return predictor.predict(
            request.window
        )

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Prediction service error: "
                f"{error}"
            ),
        ) from error