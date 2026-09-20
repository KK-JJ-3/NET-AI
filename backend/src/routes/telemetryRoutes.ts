import { Router } from "express";

import { createTelemetry } from "../controllers/telemetryController.js";
import { validate } from "../middleware/validate.js";
import { telemetrySchema } from "../validation/telemetrySchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.post("/", validate(telemetrySchema), createTelemetry);

export default router;
