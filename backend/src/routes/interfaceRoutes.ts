import { Router } from "express";

import {
  getDeviceInterfaces,
  createInterface,
  updateInterface,
  deleteInterface,
} from "../controllers/interfaceController.js";

import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/device/:deviceId", getDeviceInterfaces);

router.post("/device/:deviceId", createInterface);

router.patch("/:id", updateInterface);

router.delete("/:id", deleteInterface);

export default router;
