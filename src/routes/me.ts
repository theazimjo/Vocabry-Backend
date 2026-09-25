import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export const meRouter = Router();

meRouter.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.uid },
    include: { corpUser: true },
  });
  res.json(user);
});

const wordTargetSchema = z.object({ wordTarget: z.number().int().min(0).max(1000) });

meRouter.patch('/word-target', async (req, res) => {
  const parsed = wordTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const user = await prisma.user.update({
    where: { id: req.uid },
    data: { wordTarget: parsed.data.wordTarget },
  });
  res.json(user);
});
