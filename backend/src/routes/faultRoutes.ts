import { Router } from "express";

import { getFaults, getFaultById } from "../controllers/faultController.js";

import { validate } from "../middleware/validate.js";
import { faultQuerySchema, faultIdSchema } from "../validation/faultSchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/", validate(faultQuerySchema), getFaults);

router.get("/:id", validate(faultIdSchema), getFaultById);

export default router;
