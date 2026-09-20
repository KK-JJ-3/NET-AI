import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import prisma from "../config/database.js";
import { env } from "../config/env.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

export async function login(req: Request, res: Response): Promise<Response> {
  const { username, password } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        username,
      },
    });

    if (!user) {
      return sendError(res, "Invalid username or password", 401);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return sendError(res, "Invalid username or password", 401);
    }

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
      },
      env.jwtSecret,
      {
        expiresIn: "8h",
      },
    );

    return sendSuccess(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);

    return sendError(res, "Login failed", 500);
  }
}
export async function getCurrentUser(
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  return sendSuccess(res, {
    id: req.user.userId,
    username: req.user.username,
    role: req.user.role,
  });
}
