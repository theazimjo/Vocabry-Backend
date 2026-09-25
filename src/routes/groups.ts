import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';

export const groupsRouter = Router();

/// The fix for the VOC RTDB vulnerability, as an endpoint: a student joins
/// by PIN, the server looks up the real group and writes the membership
/// row itself. The client never gets to assert "I'm a member of group X" —
/// it can only ask "let me in with this code", and the server decides.
const joinSchema = z.object({ code: z.string().length(6) });

groupsRouter.post('/join', async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const group = await prisma.group.findUnique({
    where: { joinCode: parsed.data.code },
  });
  if (!group || group.status === 'archived') {
    return res.status(404).json({ error: 'Invalid or inactive group code' });
  }

  const membership = await prisma.groupMembership.upsert({
    where: { userId_groupId: { userId: req.uid, groupId: group.id } },
    update: {},
    create: { userId: req.uid, groupId: group.id },
  });

  res.status(201).json({ membership, group: { id: group.id, name: group.name, level: group.level } });
});

/// Read access to a group (including its member list) requires an actual
/// GroupMembership row for req.uid, OR corp staff of the same center.
/// Both checks hit the database directly — nothing here trusts a claim the
/// client supplied about its own membership, which is what let the old
/// Firebase rules be bypassed (see prisma/schema.prisma on GroupMembership).
groupsRouter.get('/:groupId', async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { id: pstr(req.params.groupId) },
    include: { memberships: { include: { user: true } } },
  });
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }

  const isMember = group.memberships.some((m) => m.userId === req.uid);
  const isStaff = isMember
    ? true
    : await prisma.corpUser
        .findUnique({ where: { userId: req.uid } })
        .then((cu) => !!cu && !cu.disabled && cu.centerId === group.centerId);

  if (!isMember && !isStaff) {
    return res.status(403).json({ error: 'Not a member of this group' });
  }

  res.json(group);
});
