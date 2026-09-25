import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';
import { isSuperAdmin } from '../middleware/roles.js';

/// Mounted at /grammar with requireAuth already applied in index.ts —
/// routes below add their own isSuperAdmin(req.email) check where the
/// action isn't scoped to the caller's own attempts.
export const grammarRouter = Router();

const createAttemptSchema = z.object({
  testTitle: z.string().max(500).optional(),
  studentName: z.string().max(200).optional(),
  studentEmail: z.string().max(300).optional(),
  answers: z.record(z.string().max(5000)),
});

grammarRouter.post('/attempts', async (req, res) => {
  const parsed = createAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const attempt = await prisma.grammarAttempt.create({
    data: { ...parsed.data, userId: req.uid, status: 'PENDING' },
  });
  res.status(201).json(attempt);
});

grammarRouter.get('/attempts/me', async (req, res) => {
  const attempts = await prisma.grammarAttempt.findMany({
    where: { userId: req.uid },
    orderBy: { createdAt: 'desc' },
  });
  res.json(attempts);
});

const statusQuerySchema = z.enum(['PENDING', 'REVIEWED']).optional();

grammarRouter.get('/attempts', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const status = statusQuerySchema.safeParse(req.query.status);
  if (!status.success) {
    return res.status(400).json({ error: status.error.flatten() });
  }
  const attempts = await prisma.grammarAttempt.findMany({
    where: status.data ? { status: status.data } : undefined,
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(attempts);
});

const scoreAttemptSchema = z.object({
  score: z.number().int().min(0).max(100),
});

grammarRouter.patch('/attempts/:id', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const parsed = scoreAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { count } = await prisma.grammarAttempt.updateMany({
    where: { id: pstr(req.params.id) },
    data: { status: 'REVIEWED', reviewedAt: new Date(), score: parsed.data.score },
  });
  if (count === 0) return res.status(404).json({ error: 'Attempt not found' });
  res.json(await prisma.grammarAttempt.findUnique({ where: { id: pstr(req.params.id) } }));
});
