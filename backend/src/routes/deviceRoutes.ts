import { Router } from "express";

import {
  createDevice,
  getDevices,
  getDeviceById,
  getDeviceTelemetry,
  updateDevice,
  deleteDevice,
} from "../controllers/deviceController.js";
import { validate } from "../middleware/validate.js";
import { telemetryHistorySchema } from "../validation/telemetrySchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/", getDevices);
router.post("/", createDevice);
router.patch("/:id", updateDevice);
router.get("/:id", getDeviceById);
router.delete("/:id", deleteDevice);
router.get(
  "/:id/telemetry",
  validate(telemetryHistorySchema),
  getDeviceTelemetry,
);

export default router;
