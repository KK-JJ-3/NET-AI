import { Router } from "express";

import { createTelemetry } from "../controllers/telemetryController.js";
import { validate } from "../middleware/validate.js";
import { telemetrySchema } from "../validation/telemetrySchema.js";

const router = Router();

router.post("/", validate(telemetrySchema), createTelemetry);

export default router;
