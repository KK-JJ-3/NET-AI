import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { sendError } from "../utils/apiResponse.js";

export interface AuthenticatedUser {
  userId: number;
  username: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization;

  if (!authorization) {
    sendError(res, "Authentication required", 401);
    return;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    sendError(res, "Invalid authorization header", 401);
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.userId !== "number" ||
      typeof decoded.username !== "string" ||
      typeof decoded.role !== "string"
    ) {
      sendError(res, "Invalid token payload", 401);
      return;
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      sendError(res, "Token expired", 401);
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      sendError(res, "Invalid token", 401);
      return;
    }

    sendError(res, "Authentication failed", 401);
  }
}
