import { Router } from "express";

import { login, getCurrentUser } from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { loginSchema } from "../validation/authSchema.js";

const router = Router();

router.post("/login", validate(loginSchema), login);

router.get("/me", authenticate, getCurrentUser);

export default router;
