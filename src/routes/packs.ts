import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';

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

packsRouter.patch('/:packId', async (req, res) => {
  const parsed = createPackSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { count } = await prisma.pack.updateMany({
    where: { id: pstr(req.params.packId), userId: req.uid },
    data: parsed.data,
  });
  if (count === 0) return res.status(404).json({ error: 'Pack not found' });
  res.json(await prisma.pack.findUnique({ where: { id: pstr(req.params.packId) }, include: { words: true } }));
});

packsRouter.delete('/:packId', async (req, res) => {
  const { count } = await prisma.pack.deleteMany({
    where: { id: pstr(req.params.packId), userId: req.uid },
  });
  if (count === 0) {
    return res.status(404).json({ error: 'Pack not found' });
  }
  res.status(204).send();
});

const wordSchema = z.object({
  word: z.string().max(300),
  translation: z.string().max(300).optional(),
  definition: z.string().max(3000).optional(),
  example: z.string().max(3000).optional(),
  notes: z.string().max(2000).optional(),
  partOfSpeech: z.string().max(50).optional(),
  mastery: z.number().min(0).max(100).optional(),
  interval: z.number().min(0).optional(),
  reviewCount: z.number().int().min(0).optional(),
  nextReview: z.string().datetime().nullable().optional(),
  lastReviewed: z.string().datetime().nullable().optional(),
  stability: z.number().min(0).optional(),
  activeRecallPasses: z.number().int().min(0).optional(),
  confirmedModes: z.array(z.string()).optional(),
});

/// Prisma's generated types want an actual Date (or null) for a DateTime?
/// field, never `undefined` — but zod's `.optional()` leaves the key out of
/// `parsed.data` entirely when the client didn't send it, and `.nullable()`
/// lets it send `null` to explicitly clear the field. This turns the
/// validated ISO string/null/undefined into what Prisma expects, and is
/// spread into the `data` object so an absent field is left out rather than
/// set to `undefined`.
function dateField<K extends string>(key: K, value: string | null | undefined): { [P in K]?: Date | null } {
  if (value === undefined) return {};
  return { [key]: value === null ? null : new Date(value) } as { [P in K]?: Date | null };
}

/// Every word route below re-checks pack ownership itself (rather than
/// trusting a wordId alone) — a wordId doesn't encode who owns its pack,
/// so skipping this would let any authenticated user edit/delete words in
/// packs that aren't theirs by guessing or enumerating ids.
async function assertOwnsPack(userId: string, packId: string): Promise<boolean> {
  const pack = await prisma.pack.findFirst({ where: { id: packId, userId } });
  return !!pack;
}

packsRouter.post('/:packId/words', async (req, res) => {
  if (!(await assertOwnsPack(req.uid, pstr(req.params.packId)))) {
    return res.status(404).json({ error: 'Pack not found' });
  }
  const parsed = wordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { nextReview, lastReviewed, ...rest } = parsed.data;
  const word = await prisma.word.create({
    data: {
      ...rest,
      packId: pstr(req.params.packId),
      ...dateField('nextReview', nextReview),
      ...dateField('lastReviewed', lastReviewed),
    },
  });
  res.status(201).json(word);
});

packsRouter.patch('/:packId/words/:wordId', async (req, res) => {
  if (!(await assertOwnsPack(req.uid, pstr(req.params.packId)))) {
    return res.status(404).json({ error: 'Pack not found' });
  }
  const parsed = wordSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { nextReview, lastReviewed, ...rest } = parsed.data;
  const { count } = await prisma.word.updateMany({
    where: { id: pstr(req.params.wordId), packId: pstr(req.params.packId) },
    data: {
      ...rest,
      ...dateField('nextReview', nextReview),
      ...dateField('lastReviewed', lastReviewed),
    },
  });
  if (count === 0) return res.status(404).json({ error: 'Word not found' });
  res.json(await prisma.word.findUnique({ where: { id: pstr(req.params.wordId) } }));
});

packsRouter.delete('/:packId/words/:wordId', async (req, res) => {
  if (!(await assertOwnsPack(req.uid, pstr(req.params.packId)))) {
    return res.status(404).json({ error: 'Pack not found' });
  }
  await prisma.word.deleteMany({ where: { id: pstr(req.params.wordId), packId: pstr(req.params.packId) } });
  res.status(204).send();
});
