import { ArrowLeft, Clock3, ShieldAlert } from "lucide-react";

function formatFaultType(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPredictedAt(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

function formatWindow(minutes) {
  if (!minutes) {
    return "Unknown";
  }

  return `${minutes} min`;
}

function getRiskPercentage(riskScore) {
  const numericRisk = Number(riskScore);

  if (Number.isNaN(numericRisk)) {
    return "—";
  }

  return `${Math.round(numericRisk * 100)}%`;
}

function PredictionDetails({ prediction, onBack }) {
  if (!prediction) {
    return (
      <div className="page-scroll">
        <div className="prediction-detail-page">
          <button
            type="button"
            onClick={onBack}
            className="prediction-detail-back"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Back to predictions</span>
          </button>

          <div className="prediction-detail-empty">
            <ShieldAlert size={24} aria-hidden="true" />

            <h1>Prediction not found</h1>

            <p>The selected prediction record is not available.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <div className="prediction-detail-page">
        <button
          type="button"
          onClick={onBack}
          className="prediction-detail-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />

          <span>Back to predictions</span>
        </button>

        <div className="prediction-detail-header">
          <div>
            <span className="page-eyebrow">PREDICTION #{prediction.id}</span>

            <h1>{formatFaultType(prediction.faultType)}</h1>

            <p>
              Detailed information for the selected network fault prediction.
            </p>
          </div>

          <span className="prediction-detail-status">
            {formatStatus(prediction.status)}
          </span>
        </div>

        <section className="prediction-detail-summary">
          <div className="prediction-detail-card">
            <span>Risk score</span>

            <strong>{getRiskPercentage(prediction.riskScore)}</strong>
          </div>

          <div className="prediction-detail-card">
            <span>Severity</span>

            <strong>{formatStatus(prediction.severity)}</strong>
          </div>

          <div className="prediction-detail-card">
            <span>Prediction window</span>

            <strong>
              <Clock3 size={16} aria-hidden="true" />

              {formatWindow(prediction.predictedWindowMinutes)}
            </strong>
          </div>

          <div className="prediction-detail-card">
            <span>Device</span>

            <strong>#{prediction.deviceId}</strong>
          </div>
        </section>

        <section className="prediction-detail-section">
          <div className="prediction-detail-section-heading">
            <span className="page-eyebrow">PREDICTION INFORMATION</span>

            <h2>Prediction details</h2>
          </div>

          <div className="prediction-detail-information">
            <div>
              <span>Fault type</span>

              <strong>{formatFaultType(prediction.faultType)}</strong>
            </div>

            <div>
              <span>Predicted at</span>

              <strong>{formatPredictedAt(prediction.predictedAt)}</strong>
            </div>

            <div>
              <span>Estimated window</span>

              <strong>{formatWindow(prediction.predictedWindowMinutes)}</strong>
            </div>

            <div>
              <span>Outcome status</span>

              <strong>{formatStatus(prediction.status)}</strong>
            </div>
          </div>
        </section>

        <section className="prediction-detail-section">
          <div className="prediction-detail-section-heading">
            <span className="page-eyebrow">AI EXPLANATION</span>

            <h2>Contributing factors</h2>
          </div>

          <div className="prediction-detail-placeholder">
            <p>
              Contributing features and the generated explanation will appear
              here once the AI prediction pipeline is connected.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default PredictionDetails;
