import type { NextFunction, Request, Response } from 'express';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { prisma } from '../lib/prisma.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid: string;
      email: string | null;
    }
  }
}

/// Requires a valid Firebase ID token in `Authorization: Bearer <token>`.
/// On success, req.uid/req.email come from the verified token — every route
/// below this middleware must use those (never a body/query param) as the
/// identity for authorization checks.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email ?? null;

    await prisma.user.upsert({
      where: { id: decoded.uid },
      update: { email: decoded.email ?? undefined },
      create: { id: decoded.uid, email: decoded.email ?? undefined },
    });

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
