import { Router } from "express";

import { login } from "../controllers/authController.js";
import { validate } from "../middleware/validate.js";
import { loginSchema } from "../validation/authSchema.js";

const router = Router();

router.post("/login", validate(loginSchema), login);

export default router;
