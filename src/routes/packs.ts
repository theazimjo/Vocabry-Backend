import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export const packsRouter = Router();

const createPackSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(3000).optional(),
  icon: z.string().max(32).optional(),
  color: z.string().max(200).optional(),
  level: z.string().max(50).optional(),
  language: z.string().max(20).optional(),
  folderId: z.string().optional(),
});

// Every query below is scoped to `userId: req.uid` — there is no path or
// query parameter that lets a caller ask for someone else's packs. This is
// the pattern that replaces Firebase's declarative ".read"/".write" rules:
// the same check, but as regular code that's easy to unit test.
packsRouter.get('/', async (req, res) => {
  const packs = await prisma.pack.findMany({
    where: { userId: req.uid },
    include: { words: true },
  });
  res.json(packs);
});

packsRouter.post('/', async (req, res) => {
  const parsed = createPackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  if (parsed.data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: parsed.data.folderId, userId: req.uid },
    });
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
  }

  const pack = await prisma.pack.create({
    data: { ...parsed.data, userId: req.uid },
  });
  res.status(201).json(pack);
});

packsRouter.delete('/:packId', async (req, res) => {
  const { count } = await prisma.pack.deleteMany({
    where: { id: req.params.packId, userId: req.uid },
  });
  if (count === 0) {
    return res.status(404).json({ error: 'Pack not found' });
  }
  res.status(204).send();
});
