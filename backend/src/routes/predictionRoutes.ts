import { Router } from "express";

import {
  getPredictions,
  getPredictionById,
} from "../controllers/predictionController.js";

import { validate } from "../middleware/validate.js";
import {
  predictionQuerySchema,
  predictionIdSchema,
} from "../validation/predictionSchema.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/", validate(predictionQuerySchema), getPredictions);

router.get("/:id", validate(predictionIdSchema), getPredictionById);

export default router;
