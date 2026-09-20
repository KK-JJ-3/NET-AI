import { Router } from "express";

import { getAlerts, acknowledgeAlert } from "../controllers/alertController.js";

import { validate } from "../middleware/validate.js";
import { alertQuerySchema, alertIdSchema } from "../validation/alertSchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/", validate(alertQuerySchema), getAlerts);

router.post("/:id/ack", validate(alertIdSchema), acknowledgeAlert);

export default router;
