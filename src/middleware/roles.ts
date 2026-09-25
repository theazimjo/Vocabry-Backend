import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';

/// Super admins are a hardcoded email allowlist, same as VOC's frontend
/// (SUPER_ADMINS in useCorpRole.js) — not a database row, so it can't be
/// escalated to by writing data.
function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdmin(email: string | null): boolean {
  return !!email && superAdminEmails().includes(email.toLowerCase());
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  next();
}

/// Loads the caller's CorpUser row (their staff membership) and checks it
/// matches :centerId from the route and isn't disabled. Attaches it to
/// req.corpUser so route handlers can read .role without a second query.
/// Super admins bypass the centerId/role check entirely.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      corpUser?: { id: string; role: 'CENTER_ADMIN' | 'TEACHER'; centerId: string };
    }
  }
}

export function requireCenterStaff(
  options: { role?: 'CENTER_ADMIN' | 'TEACHER' } = {},
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isSuperAdmin(req.email)) return next();

    const centerId = pstr(req.params.centerId);
    const corpUser = await prisma.corpUser.findUnique({ where: { userId: req.uid } });

    if (!corpUser || corpUser.disabled || corpUser.centerId !== centerId) {
      return res.status(403).json({ error: 'Not staff at this center' });
    }
    if (options.role && corpUser.role !== options.role) {
      return res.status(403).json({ error: `${options.role} only` });
    }

    req.corpUser = corpUser;
    next();
  };
}
