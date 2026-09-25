import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isSuperAdmin } from '../middleware/roles.js';

/// Mounted at /errors with requireAuth already applied in index.ts.
export const errorsRouter = Router();

const createErrorLogSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  context: z.string().max(200).optional(),
});

/// Never let a malformed report itself throw — validation failure is just
/// a 400 like everywhere else, not something this endpoint tries to log.
errorsRouter.post('/', async (req, res) => {
  const parsed = createErrorLogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const errorLog = await prisma.errorLog.create({
    data: { ...parsed.data, userId: req.uid },
  });
  res.status(201).json(errorLog);
});

errorsRouter.get('/', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const errorLogs = await prisma.errorLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: true },
  });
  res.json(errorLogs);
});
