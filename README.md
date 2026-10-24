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

> **Telemetry interval:** the AI feature pipeline assumes readings are approximately **60 seconds apart**. Use the simulator's default `--interval 60` unless you have deliberately changed and tested the feature pipeline. The AI service validates reading intervals and rejects unsuitable windows.

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

The backend can save telemetry even if the AI service is temporarily unavailable, but prediction generation requires the AI service to be reachable.

## Troubleshooting

- **Backend health check fails:** verify MySQL is running, the database exists, and `.env` has matching `DB_*` and `DATABASE_URL` values.
- **Prisma cannot connect:** check the database host/port and password, then rerun `npx prisma migrate deploy` from `backend/`.
- **AI service fails at startup:** confirm the virtual environment dependencies are installed and the model artifacts exist in `ai-service/models/`.
- **`/predict` returns HTTP 422:** inspect the request window. It must contain the required telemetry values and readings spaced approximately one minute apart.
- **Simulator login fails:** set `NETFAULT_USERNAME` and `NETFAULT_PASSWORD` in the same terminal where you run the simulator, and use valid application credentials.
- **No charts or predictions appear:** make sure the simulator is targeting a real device ID, the AI service is healthy, and enough telemetry has been submitted. Check the backend and AI-service terminal logs. The simulator now queries the device's latest timestamp before a run; if that lookup fails, check backend availability and authentication.
- **Frontend cannot reach the API:** confirm the backend is running on port 5000 and that the frontend API base URL matches it.

## Project status and limitations

This is a development/demo project. Its supplied model evaluation and simulator results are synthetic. Run the browser-based end-to-end checks and validate the demo flow in your own environment before presenting it as complete. The documented training and evaluation commands are provided for reproducibility; retraining is not part of the normal startup procedure.
