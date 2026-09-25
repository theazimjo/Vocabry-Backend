import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { randomJoinCode } from '../lib/joinCode.js';
import { requireCenterStaff } from '../middleware/roles.js';
import { corpGroupsRouter } from './corpGroups.js';
import { corpPacksRouter } from './corpPacks.js';
import { pstr } from '../lib/params.js';

/// Mounted at /corp with requireAuth already applied in index.ts.
/// Center-scoped routes each add requireCenterStaff(...) themselves so the
/// required role can differ per route (e.g. only CENTER_ADMIN can approve a
/// join request, but any staff can read the center).
export const corpRouter = Router();

corpRouter.get('/centers/:centerId', requireCenterStaff(), async (req, res) => {
  const center = await prisma.center.findUnique({ where: { id: pstr(req.params.centerId) } });
  if (!center) return res.status(404).json({ error: 'Center not found' });
  res.json(center);
});

corpRouter.get('/centers/:centerId/teachers', requireCenterStaff(), async (req, res) => {
  const teachers = await prisma.corpUser.findMany({
    where: { centerId: pstr(req.params.centerId), role: 'TEACHER' },
    include: { user: true },
  });
  res.json(teachers);
});

async function issueUniqueTeacherJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomJoinCode();
    const taken = await prisma.center.findUnique({ where: { teacherJoinCode: code } });
    if (!taken) return code;
  }
  throw new Error('Could not generate a unique join code');
}

corpRouter.post(
  '/centers/:centerId/teacher-join-code',
  requireCenterStaff({ role: 'CENTER_ADMIN' }),
  async (req, res) => {
    const center = await prisma.center.findUnique({ where: { id: pstr(req.params.centerId) } });
    if (!center) return res.status(404).json({ error: 'Center not found' });
    if (center.teacherJoinCode) return res.json({ code: center.teacherJoinCode });

    const code = await issueUniqueTeacherJoinCode();
    await prisma.center.update({ where: { id: center.id }, data: { teacherJoinCode: code } });
    res.json({ code });
  },
);

corpRouter.post(
  '/centers/:centerId/teacher-join-code/regenerate',
  requireCenterStaff({ role: 'CENTER_ADMIN' }),
  async (req, res) => {
    const code = await issueUniqueTeacherJoinCode();
    await prisma.center.update({ where: { id: pstr(req.params.centerId) }, data: { teacherJoinCode: code } });
    res.json({ code });
  },
);

const joinRequestSchema = z.object({
  code: z.string().length(6),
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
});

/// Self-service: a signed-in personal account requests to become a teacher
/// at the center identified by `code`. Does not grant any access by
/// itself — only POST .../join-requests/:uid/approve (center_admin) does,
/// by creating the CorpUser row.
corpRouter.post('/join-requests', async (req, res) => {
  const parsed = joinRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const center = await prisma.center.findUnique({ where: { teacherJoinCode: parsed.data.code } });
  if (!center) return res.status(404).json({ error: 'Invalid join code' });
  if (center.status === 'suspended') return res.status(403).json({ error: 'This center is suspended' });

  const alreadyStaff = await prisma.corpUser.findUnique({ where: { userId: req.uid } });
  if (alreadyStaff) return res.status(409).json({ error: 'This account already has a corp role' });

  const existingRequest = await prisma.teacherJoinRequest.findUnique({ where: { userId: req.uid } });
  if (existingRequest) return res.status(409).json({ error: 'You already have a pending request' });

  const request = await prisma.teacherJoinRequest.create({
    data: { userId: req.uid, centerId: center.id, name: parsed.data.name, phone: parsed.data.phone },
  });
  res.status(201).json(request);
});

corpRouter.get('/join-requests/me', async (req, res) => {
  const request = await prisma.teacherJoinRequest.findUnique({ where: { userId: req.uid } });
  res.json(request);
});

corpRouter.delete('/join-requests/me', async (req, res) => {
  await prisma.teacherJoinRequest.deleteMany({ where: { userId: req.uid } });
  res.status(204).send();
});

corpRouter.get(
  '/centers/:centerId/join-requests',
  requireCenterStaff({ role: 'CENTER_ADMIN' }),
  async (req, res) => {
    const requests = await prisma.teacherJoinRequest.findMany({
      where: { centerId: pstr(req.params.centerId) },
      include: { user: true },
    });
    res.json(requests);
  },
);

corpRouter.post(
  '/centers/:centerId/join-requests/:uid/approve',
  requireCenterStaff({ role: 'CENTER_ADMIN' }),
  async (req, res) => {
    const request = await prisma.teacherJoinRequest.findUnique({
      where: { userId: pstr(req.params.uid) },
    });
    if (!request || request.centerId !== pstr(req.params.centerId)) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const [corpUser] = await prisma.$transaction([
      prisma.corpUser.create({
        data: {
          userId: request.userId,
          centerId: request.centerId,
          role: 'TEACHER',
          name: request.name,
          phone: request.phone,
        },
      }),
      prisma.teacherJoinRequest.delete({ where: { id: request.id } }),
    ]);
    res.status(201).json(corpUser);
  },
);

corpRouter.post(
  '/centers/:centerId/join-requests/:uid/reject',
  requireCenterStaff({ role: 'CENTER_ADMIN' }),
  async (req, res) => {
    await prisma.teacherJoinRequest.deleteMany({
      where: { userId: pstr(req.params.uid), centerId: pstr(req.params.centerId) },
    });
    res.status(204).send();
  },
);

corpRouter.use('/centers/:centerId/groups', corpGroupsRouter);
corpRouter.use('/centers/:centerId/packs', corpPacksRouter);
