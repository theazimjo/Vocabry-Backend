import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireCenterStaff } from '../middleware/roles.js';
import { pstr } from '../lib/params.js';

/// Mounted at /corp/centers/:centerId/packs (see routes/corp.ts) with
/// { mergeParams: true } so req.params.centerId is available here.
export const corpPacksRouter = Router({ mergeParams: true });

const wordSchema = z.object({
  word: z.string(),
  translation: z.string().optional(),
  definition: z.string().optional(),
  example: z.string().optional(),
});

const createPackSchema = z.object({
  title: z.string().min(1).max(200),
  level: z.string().max(50).optional(),
  description: z.string().max(3000).optional(),
  language: z.string().max(20).optional(),
  words: z.array(wordSchema).optional(),
  private: z.boolean().optional(),
});

const updatePackSchema = createPackSchema.partial();

/// Center admins see every pack in the center; teachers see center-wide
/// shared packs (ownerUid null) plus their own private ones — a private
/// pack is only ever visible to its creator and center admins.
corpPacksRouter.get('/', requireCenterStaff(), async (req, res) => {
  const centerId = pstr(req.params.centerId);
  const where =
    req.corpUser!.role === 'CENTER_ADMIN'
      ? { centerId }
      : { centerId, OR: [{ ownerUid: null }, { ownerUid: req.uid }] };

  const packs = await prisma.corpPack.findMany({ where });
  res.json(packs);
});

corpPacksRouter.post('/', requireCenterStaff(), async (req, res) => {
  const parsed = createPackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { private: isPrivate, ...data } = parsed.data;
  const pack = await prisma.corpPack.create({
    data: {
      ...data,
      centerId: pstr(req.params.centerId),
      ownerUid: isPrivate === true ? req.uid : null,
    },
  });
  res.status(201).json(pack);
});

async function loadOwnedPack(centerId: string, packId: string) {
  return prisma.corpPack.findFirst({ where: { id: packId, centerId } });
}

corpPacksRouter.patch('/:packId', requireCenterStaff(), async (req, res) => {
  const pack = await loadOwnedPack(pstr(req.params.centerId), pstr(req.params.packId));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  if (pack.ownerUid !== req.uid && req.corpUser!.role !== 'CENTER_ADMIN') {
    return res.status(403).json({ error: 'Not your pack' });
  }

  const parsed = updatePackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { private: isPrivate, ...data } = parsed.data;
  const updated = await prisma.corpPack.update({
    where: { id: pack.id },
    data: {
      ...data,
      ...(isPrivate !== undefined ? { ownerUid: isPrivate ? req.uid : null } : {}),
    },
  });
  res.json(updated);
});

corpPacksRouter.delete('/:packId', requireCenterStaff(), async (req, res) => {
  const pack = await loadOwnedPack(pstr(req.params.centerId), pstr(req.params.packId));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  if (pack.ownerUid !== req.uid && req.corpUser!.role !== 'CENTER_ADMIN') {
    return res.status(403).json({ error: 'Not your pack' });
  }

  await prisma.corpPack.delete({ where: { id: pack.id } });
  res.status(204).send();
});

corpPacksRouter.post('/:packId/assign/:groupId', requireCenterStaff(), async (req, res) => {
  const centerId = pstr(req.params.centerId);
  const pack = await loadOwnedPack(centerId, pstr(req.params.packId));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  const group = await prisma.group.findFirst({ where: { id: pstr(req.params.groupId), centerId } });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.corpUser!.role === 'TEACHER' && group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  const assignedPackIds = group.assignedPackIds as string[];
  const next = assignedPackIds.includes(pack.id) ? assignedPackIds : [...assignedPackIds, pack.id];
  const updated = await prisma.group.update({
    where: { id: group.id },
    data: { assignedPackIds: next },
  });
  res.json(updated);
});

corpPacksRouter.delete('/:packId/assign/:groupId', requireCenterStaff(), async (req, res) => {
  const centerId = pstr(req.params.centerId);
  const pack = await loadOwnedPack(centerId, pstr(req.params.packId));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  const group = await prisma.group.findFirst({ where: { id: pstr(req.params.groupId), centerId } });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.corpUser!.role === 'TEACHER' && group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  const assignedPackIds = group.assignedPackIds as string[];
  const next = assignedPackIds.filter((id) => id !== pack.id);
  const updated = await prisma.group.update({
    where: { id: group.id },
    data: { assignedPackIds: next },
  });
  res.json(updated);
});
