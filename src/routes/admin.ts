import { Router } from 'express';
import { z } from 'zod';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';

/// Mounted at /admin with requireAuth + requireSuperAdmin already applied
/// in index.ts — nothing in here needs its own per-route auth check.
export const adminRouter = Router();

adminRouter.get('/centers', async (_req, res) => {
  const centers = await prisma.center.findMany({ orderBy: { name: 'asc' } });
  res.json(centers);
});

const createCenterSchema = z.object({
  name: z.string().min(1).max(200),
  adminEmail: z.string().email(),
  phone: z.string().max(50).optional(),
});

adminRouter.post('/centers', async (req, res) => {
  const parsed = createCenterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const center = await prisma.center.create({ data: parsed.data });
  res.status(201).json(center);
});

adminRouter.patch('/centers/:centerId/status', async (req, res) => {
  const status = z.enum(['active', 'suspended']).safeParse(req.body.status);
  if (!status.success) {
    return res.status(400).json({ error: 'status must be "active" or "suspended"' });
  }
  const center = await prisma.center.update({
    where: { id: pstr(req.params.centerId) },
    data: { status: status.data },
  });
  res.json(center);
});

function randomTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/// Creates the Firebase Auth account for a center's admin (via Admin SDK —
/// no "secondary auth" workaround needed server-side, unlike the old
/// client-side implementation) and the CorpUser role record. The temp
/// password is returned once for the super admin to hand off out of band.
adminRouter.post('/centers/:centerId/admin-account', async (req, res) => {
  const center = await prisma.center.findUnique({ where: { id: pstr(req.params.centerId) } });
  if (!center) return res.status(404).json({ error: 'Center not found' });
  if (!center.adminEmail) return res.status(400).json({ error: 'Center has no adminEmail set' });

  const existing = await prisma.corpUser.findFirst({
    where: { centerId: center.id, role: 'CENTER_ADMIN' },
  });
  if (existing) return res.status(409).json({ error: 'Center already has an admin account' });

  const tempPassword = randomTempPassword();
  let firebaseUser;
  try {
    firebaseUser = await firebaseAuth.createUser({ email: center.adminEmail, password: tempPassword });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    throw err;
  }

  await prisma.user.upsert({
    where: { id: firebaseUser.uid },
    update: { email: center.adminEmail },
    create: { id: firebaseUser.uid, email: center.adminEmail },
  });
  await prisma.corpUser.create({
    data: { userId: firebaseUser.uid, centerId: center.id, role: 'CENTER_ADMIN' },
  });

  res.status(201).json({ email: center.adminEmail, tempPassword });
});

adminRouter.get('/corp-users', async (_req, res) => {
  const corpUsers = await prisma.corpUser.findMany({ include: { user: true, center: true } });
  res.json(corpUsers);
});

adminRouter.patch('/corp-users/:corpUserId', async (req, res) => {
  const disabled = z.boolean().safeParse(req.body.disabled);
  if (!disabled.success) {
    return res.status(400).json({ error: '"disabled" must be a boolean' });
  }
  const corpUser = await prisma.corpUser.update({
    where: { id: pstr(req.params.corpUserId) },
    data: { disabled: disabled.data },
  });
  res.json(corpUser);
});

adminRouter.delete('/corp-users/:corpUserId', async (req, res) => {
  await prisma.corpUser.delete({ where: { id: pstr(req.params.corpUserId) } });
  res.status(204).send();
});
