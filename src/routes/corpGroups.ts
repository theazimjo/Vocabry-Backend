import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { randomJoinCode } from '../lib/joinCode.js';
import { requireCenterStaff } from '../middleware/roles.js';
import { pstr } from '../lib/params.js';

/// Mounted at /corp/centers/:centerId/groups (see routes/corp.ts) with
/// { mergeParams: true } so req.params.centerId is available here.
export const corpGroupsRouter = Router({ mergeParams: true });

const createGroupSchema = z.object({
  name: z.string().min(1).max(200),
  level: z.string().max(50).optional(),
});

async function issueUniqueGroupCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomJoinCode();
    const taken = await prisma.group.findUnique({ where: { joinCode: code } });
    if (!taken) return code;
  }
  throw new Error('Could not generate a unique join code');
}

corpGroupsRouter.post('/', requireCenterStaff({ role: 'TEACHER' }), async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const joinCode = await issueUniqueGroupCode();
  const group = await prisma.group.create({
    data: {
      ...parsed.data,
      centerId: pstr(req.params.centerId),
      teacherId: req.corpUser!.id,
      joinCode,
    },
  });
  res.status(201).json(group);
});

/// Center admins see every group; teachers see only their own — matching
/// the old RTDB rule (a group's .write required data.teacherId === the
/// caller's own teacherId), now enforced as a query filter instead.
corpGroupsRouter.get('/', requireCenterStaff(), async (req, res) => {
  const where =
    req.corpUser!.role === 'CENTER_ADMIN'
      ? { centerId: pstr(req.params.centerId) }
      : { centerId: pstr(req.params.centerId), teacherId: req.corpUser!.id };

  const groups = await prisma.group.findMany({
    where,
    include: { _count: { select: { memberships: true } } },
  });
  res.json(groups);
});

async function loadOwnedGroup(centerId: string, groupId: string) {
  return prisma.group.findFirst({ where: { id: groupId, centerId } });
}

corpGroupsRouter.get('/:groupId/students', requireCenterStaff(), async (req, res) => {
  const group = await loadOwnedGroup(pstr(req.params.centerId), pstr(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.corpUser!.role === 'TEACHER' && group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  const memberships = await prisma.groupMembership.findMany({
    where: { groupId: group.id },
    include: { user: true },
  });
  res.json(memberships);
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  level: z.string().max(50).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

corpGroupsRouter.patch('/:groupId', requireCenterStaff(), async (req, res) => {
  const group = await loadOwnedGroup(pstr(req.params.centerId), pstr(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.corpUser!.role === 'TEACHER' && group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  const parsed = updateGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updated = await prisma.group.update({ where: { id: group.id }, data: parsed.data });
  res.json(updated);
});

corpGroupsRouter.delete('/:groupId/students/:uid', requireCenterStaff(), async (req, res) => {
  const group = await loadOwnedGroup(pstr(req.params.centerId), pstr(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.corpUser!.role === 'TEACHER' && group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  await prisma.groupMembership.deleteMany({ where: { groupId: group.id, userId: pstr(req.params.uid) } });
  res.status(204).send();
});
