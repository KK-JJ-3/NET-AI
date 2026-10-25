# NetFault AI

NetFault AI is a network-fault monitoring and prediction system. It combines a React dashboard, an Express/TypeScript API backed by MySQL, and a Python/FastAPI service that analyses telemetry and predicts network faults.

The repository is organised as a small monorepo:

```text
NET-AI/
├── ai-service/   # FastAPI prediction service, ML models, training and simulator
├── backend/      # Express API, Prisma schema/migrations, authentication and evaluation
└── frontend/     # React + Vite dashboard
```

## Features

- Collect network telemetry for devices and interfaces.
- Generate fault forecasts and active-fault detections using the AI service.
- Store devices, telemetry, predictions, faults and alerts in the database.
- View dashboard metrics and prediction, fault and alert details in the frontend.
- Push live telemetry updates to connected clients with Socket.IO.
- Simulate normal traffic, congestion and device-failure scenarios.
- Evaluate forecasts and active detections separately.

> **Telemetry interval:** The AI feature pipeline expects at least **15 telemetry readings**, with consecutive readings approximately **60 seconds apart**. The AI service allows a tolerance of **plus or minus 5 seconds** (55 to 65 seconds per interval). Use the simulator's default `--interval 60`. Windows with irregular intervals, missing required metric values, or non-finite metric values are rejected.

## Requirements

Install these before setup:

- Git
- Node.js and npm (a current LTS release is recommended)
- Python 3.11 or a compatible version supported by the pinned dependencies
- MySQL 8.x, running locally or on a reachable database host

The commands below use PowerShell on Windows, but the equivalent commands work in other shells with minor environment-variable syntax changes.

## 1. Get the project

```powershell
git clone <your-repository-url>
cd NET-AI
```

If you already have the repository, open a terminal at its root directory.

## 2. Configure the database and backend

Create a MySQL database named `netfault_ai` (or choose another name and update the environment values below).

From the `backend` directory, create your local environment file:

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` and set values for your environment. At minimum, configure:

```dotenv
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=netfault_ai

DATABASE_URL="mysql://root:your_mysql_password@localhost:3306/netfault_ai"

JWT_SECRET=replace_with_a_long_random_secret
AI_SERVICE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173
```

Use the same database credentials in `DB_*` and `DATABASE_URL`. URL-encode special characters in the database password when placing it in `DATABASE_URL`. Do not commit `.env` or real credentials.

Install backend dependencies and apply the checked-in Prisma migrations:

```powershell
npm install
npx prisma migrate deploy
npx prisma generate
```

Start the API in development mode:

```powershell
npm run dev
```

The backend listens on `http://localhost:5000` by default. In a separate terminal, verify the API and database connection:

- API root: `http://localhost:5000/`
- Health check: `http://localhost:5000/api/health`

The health check should report that the server is running and the database is connected.

### Backend commands

Run these from `backend/`:

```powershell
npm run dev       # Start the development server
npm run build     # Type-check and compile TypeScript into dist/
npm start         # Run the compiled backend
npm test          # Run backend tests
npm run evaluate  # Evaluate stored forecasts and active detections
```

The simulator uses the backend's authentication endpoint. You need a valid application account and a valid device ID in the database before running a simulation. This repository snapshot does not define a universal demo username/password.

## 3. Set up and run the AI service

Open a second terminal at the repository root:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

The repository includes trained model artifacts in `ai-service/models/`. The API loads these files when the application starts, so **retraining is not required for a normal run**.

Start the service:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Useful endpoints:

- Health: `http://localhost:8000/health`
- Interactive API documentation: `http://localhost:8000/docs`

### Train or regenerate the models

Only do this when intentionally updating the training artifacts. Run from `ai-service/` with its virtual environment active:

```powershell
python -m training.train_models
```

Training writes model and evaluation artifacts under `ai-service/models/`. Keep the training configuration, label horizon, evaluation scripts and reported results consistent when making model changes. Clearly identify simulator-derived results as synthetic; they are not evidence from a production network.

### AI service tests

From `ai-service/`:

```powershell
python -m pytest -q
```

## 4. Run the frontend

Open a third terminal at the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

The current frontend API client uses `http://localhost:5000/api` as its backend base URL. If you change the backend host or port, update the frontend API configuration accordingly.

### Frontend commands

Run these from `frontend/`:

```powershell
npm run dev      # Start the Vite development server
npm run build    # Create a production build
npm run lint     # Run ESLint
npm run preview  # Preview the production build
```

## 5. Run a simulator scenario

Run the simulator from `ai-service/`. First set the credentials for a valid backend account in the current PowerShell session. Replace the example values with your actual account credentials:

```powershell
$env:NETFAULT_USERNAME = "your_username"
$env:NETFAULT_PASSWORD = "your_password"
```

Use a device ID that exists in your database. Example normal-traffic run:

```powershell
python -m simulator.run_simulator --scenario normal --device-id 1 --time-mode accelerated --duration 30
```

Example congestion run:

```powershell
python -m simulator.run_simulator --scenario congestion --device-id 1 --time-mode accelerated --duration 60
```

Example device-failure run:

```powershell
python -m simulator.run_simulator --scenario device_failure --device-id 1 --time-mode accelerated --duration 60
```

The simulator supports `normal`, `congestion` and `device_failure`. It defaults to one-minute readings and appends a healthy telemetry tail so forecast outcomes have time to resolve in simulated time. The default tail is 10 minutes; set `--tail-minutes 0` to disable it. Before each run, it reads the device's latest stored telemetry timestamp and starts at the later of the current UTC time or one configured interval after that timestamp. This keeps repeated accelerated runs on the same device in chronological order, so the backend's 15-reading AI window does not mix timestamps from overlapping runs. The timestamp lookup requires the authenticated backend to be running.

### Simulator help

To see the available scenarios, options, defaults and usage directly from the simulator CLI, run this from `ai-service/` with the virtual environment activated:

```powershell
python -m simulator.run_simulator --help
```

Use the help output as the source of truth if command-line options change. For example, it documents options such as the scenario, device/interface IDs, duration, interval, time mode, API base URL and tail duration.

Optional arguments include:

- `--interface-id <id>` to associate readings with an existing interface
- `--interval 60` to set the telemetry interval in seconds
- `--time-mode live` to use wall-clock pacing/timestamps instead of accelerated simulation
- `--base-url http://localhost:5000/api` to override the backend API URL

To review the results after the simulator and backend outcome evaluation have finished, run this from `backend/`:

```powershell
npm run evaluate
```

The report separates forecast metrics from active-detection metrics. Forecast recall counts recorded faults that were covered by a forecast; a fault with no covering forecast is counted as missed. Interpret the metrics alongside the scenario and evaluation window, rather than treating simulator results as production performance.

## 6. Suggested local startup order

Start each service in its own terminal:

1. Start MySQL.
2. Start the backend from `backend/` with `npm run dev`.
3. Start the AI service from `ai-service/` with `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`.
4. Start the frontend from `frontend/` with `npm run dev`.
5. Sign in to the dashboard, then run a simulator scenario using a valid account and device ID.

The backend persists incoming telemetry before attempting AI scoring. Prediction scoring normally runs when a device reaches 15 stored telemetry readings and then every 5 additional readings. A new reading reporting an outage can also trigger scoring immediately once the device has at least 15 readings.

If AI scoring fails?for example, because the AI service is unavailable or rejects an unsuitable telemetry window?the backend logs the scoring error but preserves the saved telemetry. The ingestion request still returns HTTP `201 Created`, with the saved telemetry and `prediction: null` when no prediction was generated. A successful ingestion response therefore does not guarantee that a prediction was created.

## Troubleshooting

- **Backend health check fails:** verify MySQL is running, the database exists, and `.env` has matching `DB_*` and `DATABASE_URL` values.
- **Prisma cannot connect:** check the database host/port and password, then rerun `npx prisma migrate deploy` from `backend/`.
- **AI service fails at startup:** confirm the virtual environment dependencies are installed and the model artifacts exist in `ai-service/models/`.
- **`/predict` returns HTTP 422:** Check that the request contains at least 15 readings, that consecutive timestamps are 55 to 65 seconds apart, and that all required telemetry metrics are present and finite. Check for duplicate timestamps, missing metric values, or an incorrect sampling interval. If telemetry was submitted through the backend, remember that it may already be stored even when AI scoring fails; inspect the backend logs and stored telemetry before retrying.
- **Simulator login fails:** set `NETFAULT_USERNAME` and `NETFAULT_PASSWORD` in the same terminal where you run the simulator, and use valid application credentials.
- **No charts or predictions appear:** make sure the simulator is targeting a real device ID, the AI service is healthy, and enough telemetry has been submitted. Check the backend and AI-service terminal logs. The simulator now queries the device's latest timestamp before a run; if that lookup fails, check backend availability and authentication.
- **Frontend cannot reach the API:** confirm the backend is running on port 5000 and that the frontend API base URL matches it.

## Risk-score interpretation and saturation (A3)

NetFault AI currently keeps the existing risk calculation; it does not apply a post-hoc calibration transform.

- **Forecasts:** `riskScore = 1 - P(normal)`, the sum of the XGBoost classifier's congestion and device-failure probabilities for the configured forecast horizon. Because the classifier can return highly confident probabilities, scores may cluster near 0 or 1. The score is model-derived and should not be presented as a separately calibrated real-world probability.
- **Active detections:** `ai-service/app/predictor.py` returns `riskScore = 1.0` when two consecutive readings indicate an unavailable device or when the configured active-congestion thresholds are both met. This fixed value represents an already-detected condition; it is not a forecast probability.
- **UI rounding:** risk values are displayed as whole percentages, so a forecast score just below `1.0` can display as `100%`. Check the stored numeric value and explanation when distinguishing a near-maximum forecast from an active detection.
- **Calibration decision:** a prior calibration experiment worsened Brier score and log loss, so no calibration layer is enabled. Do not change the formula or add a calibration transform solely to make scores look less saturated. Revisit calibration only with held-out evaluation and report Brier score/log loss alongside false-positive and missed-fault rates, ideally across multiple seeds.
- **Decision threshold:** the current forecast decision threshold remains `0.40`. Threshold tuning changes which class is emitted; it does not calibrate the score itself. Existing threshold-sweep reports are classification evaluations, not evidence that the scores are calibrated.

The current A3 resolution is therefore to preserve the tested decision behavior, make the score's meaning explicit, and treat calibration as a limitation until a validated alternative improves proper scoring rules without unacceptable detection regressions.

## Project status and limitations

This is a development/demo project. Its supplied model evaluation and simulator results are synthetic. Run the browser-based end-to-end checks and validate the demo flow in your own environment before presenting it as complete. The documented training and evaluation commands are provided for reproducibility; retraining is not part of the normal startup procedure.
