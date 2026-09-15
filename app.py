from fastapi import FastAPI
from pydantic import BaseModel
from predict import predict

app = FastAPI(
    title="Network Fault Detection API",
    description="AI-powered predictive network fault detection",
    version="1.0"
)


class NetworkData(BaseModel):
    latency_ms: float
    packet_loss_pct: float
    bandwidth_utilization_pct: float
    cpu_utilization_pct: float
    memory_utilization_pct: float
    throughput_mbps: float
    jitter_ms: float
    error_rate: float
    active_connections: float
    temperature_c: float
    signal_strength_pct: float


@app.get("/")
def home():
    return {
        "message": "Network Fault Detection API is running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/predict")
def predict_network(data: NetworkData):

    result = predict(data.model_dump())

    return result