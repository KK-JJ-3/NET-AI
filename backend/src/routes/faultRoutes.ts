import { Router } from "express";

import {
  createFault,
  getFaults,
  getFaultById,
  resolveFault,
} from "../controllers/faultController.js";

import { validate } from "../middleware/validate.js";
import {
  createFaultSchema,
  faultQuerySchema,
  faultIdSchema,
} from "../validation/faultSchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// All fault routes require JWT authentication.
router.use(authenticate);

router.post("/", validate(createFaultSchema), createFault);
router.get("/", validate(faultQuerySchema), getFaults);
router.get("/:id", validate(faultIdSchema), getFaultById);
router.patch("/:id/resolve", validate(faultIdSchema), resolveFault);

export default router;
