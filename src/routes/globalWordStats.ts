import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pstr } from '../lib/params.js';

export const globalWordStatsRouter = Router();

/// Mirrors normalizeWordKey in VOC's src/experiment/experimentDB.js exactly
/// (lowercase + trim + strip everything but a-z) so a word reviewed by the
/// old client and one reviewed here land on the same row.
function normalizeWordKey(text: string): string {
  const key = (text || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return key || 'unknown';
}

globalWordStatsRouter.get('/:word', async (req, res) => {
  const wordKey = normalizeWordKey(pstr(req.params.word));
  const stat = await prisma.globalWordStat.findUnique({ where: { wordKey } });
  res.json(stat ?? { wordKey, totalReviews: 0, totalCorrect: 0 });
});

const reviewSchema = z.object({
  correct: z.boolean(),
});

globalWordStatsRouter.post('/:word/review', async (req, res) => {
  const wordKey = normalizeWordKey(pstr(req.params.word));
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { correct } = parsed.data;

  // One atomic upsert stands in for the old Firebase runTransaction —
  // Postgres row-level atomicity gives us the same "never clobber a
  // concurrent reviewer's increment" guarantee.
  const stat = await prisma.globalWordStat.upsert({
    where: { wordKey },
    create: { wordKey, totalReviews: 1, totalCorrect: correct ? 1 : 0 },
    update: { totalReviews: { increment: 1 }, totalCorrect: correct ? { increment: 1 } : undefined },
  });
  res.json(stat);
});
