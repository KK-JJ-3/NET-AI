import { Router } from "express";

import { getAlerts, acknowledgeAlert } from "../controllers/alertController.js";

import { validate } from "../middleware/validate.js";
import { alertQuerySchema, alertIdSchema } from "../validation/alertSchema.js";

const router = Router();

router.get("/", validate(alertQuerySchema), getAlerts);

router.post("/:id/ack", validate(alertIdSchema), acknowledgeAlert);

export default router;
