import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';

export const foldersRouter = Router();

const folderSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(32).optional(),
});

foldersRouter.get('/', async (req, res) => {
  const folders = await prisma.folder.findMany({ where: { userId: req.uid } });
  res.json(folders);
});

foldersRouter.post('/', async (req, res) => {
  const parsed = folderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const folder = await prisma.folder.create({ data: { ...parsed.data, userId: req.uid } });
  res.status(201).json(folder);
});

foldersRouter.patch('/:folderId', async (req, res) => {
  const parsed = folderSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { count } = await prisma.folder.updateMany({
    where: { id: pstr(req.params.folderId), userId: req.uid },
    data: parsed.data,
  });
  if (count === 0) return res.status(404).json({ error: 'Folder not found' });
  res.json(await prisma.folder.findUnique({ where: { id: pstr(req.params.folderId) } }));
});

/// Deleting a folder only un-files its packs (folderId -> null) — it never
/// cascades to deleting the packs themselves.
foldersRouter.delete('/:folderId', async (req, res) => {
  const folder = await prisma.folder.findFirst({
    where: { id: pstr(req.params.folderId), userId: req.uid },
  });
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  await prisma.$transaction([
    prisma.pack.updateMany({ where: { folderId: folder.id }, data: { folderId: null } }),
    prisma.folder.delete({ where: { id: folder.id } }),
  ]);
  res.status(204).send();
});
