import { Router } from "express";

import { getDevices, getDeviceById } from "../controllers/deviceController.js";
import { getDeviceTelemetry } from "../controllers/deviceController.js";
import { validate } from "../middleware/validate.js";
import { telemetryHistorySchema } from "../validation/telemetrySchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/", getDevices);
router.get("/:id", getDeviceById);
router.get(
  "/:id/telemetry",
  validate(telemetryHistorySchema),
  getDeviceTelemetry,
);

export default router;
