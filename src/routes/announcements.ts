import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';
import { isSuperAdmin } from '../middleware/roles.js';

export const announcementsRouter = Router();

const announcementSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.enum(['info', 'warning', 'critical']).default('info'),
  target: z.enum(['all', 'center_admin', 'teacher']).default('all'),
});

/// Lowercased-with-underscore form of CorpRole, matching Announcement.target
/// ('CENTER_ADMIN' -> 'center_admin') — a personal learner has no CorpUser
/// row, so they fall through to seeing only target: 'all'.
function targetForRole(role: 'CENTER_ADMIN' | 'TEACHER' | undefined): string | null {
  if (!role) return null;
  return role.toLowerCase();
}

announcementsRouter.get('/active', async (req, res) => {
  const corpUser = await prisma.corpUser.findUnique({ where: { userId: req.uid } });
  const roleTarget = targetForRole(corpUser?.role);

  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      target: roleTarget ? { in: ['all', roleTarget] } : 'all',
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(announcements);
});

announcementsRouter.get('/', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(announcements);
});

announcementsRouter.post('/', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const announcement = await prisma.announcement.create({
    data: { ...parsed.data, isActive: true },
  });
  res.status(201).json(announcement);
});

const updateAnnouncementSchema = announcementSchema.partial().extend({
  isActive: z.boolean().optional(),
});

announcementsRouter.patch('/:id', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const parsed = updateAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { count } = await prisma.announcement.updateMany({
    where: { id: pstr(req.params.id) },
    data: parsed.data,
  });
  if (count === 0) return res.status(404).json({ error: 'Announcement not found' });
  res.json(await prisma.announcement.findUnique({ where: { id: pstr(req.params.id) } }));
});

announcementsRouter.delete('/:id', async (req, res) => {
  if (!isSuperAdmin(req.email)) {
    return res.status(403).json({ error: 'Super admin only' });
  }
  const { count } = await prisma.announcement.deleteMany({ where: { id: pstr(req.params.id) } });
  if (count === 0) {
    return res.status(404).json({ error: 'Announcement not found' });
  }
  res.status(204).send();
});
