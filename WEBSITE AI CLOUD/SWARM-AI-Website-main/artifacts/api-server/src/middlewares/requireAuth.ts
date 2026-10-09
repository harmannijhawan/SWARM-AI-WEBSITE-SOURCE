import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export type AuthenticatedRequest = Request & { authUserId: string };

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  (req as AuthenticatedRequest).authUserId = userId;
  next();
}
