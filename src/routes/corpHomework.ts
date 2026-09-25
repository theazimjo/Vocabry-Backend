import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireCenterStaff } from '../middleware/roles.js';
import { pstr } from '../lib/params.js';

/// Mounted at /corp/centers/:centerId/groups/:groupId/homework (see
/// routes/corp.ts) with { mergeParams: true } — mergeParams cascades
/// through the nested corpGroupsRouter mount, so both :centerId and
/// :groupId are already in req.params here.
export const corpHomeworkRouter = Router({ mergeParams: true });

async function loadOwnedGroup(centerId: string, groupId: string) {
  return prisma.group.findFirst({ where: { id: groupId, centerId } });
}

const homeworkItemSchema = z.object({
  packId: z.string(),
  monthId: z.string().optional(),
  unitId: z.string().optional(),
  packTitle: z.string().optional(),
  unitTitle: z.string().optional(),
  totalWords: z.number().optional(),
});

const createHomeworkSchema = z.object({
  items: z.array(homeworkItemSchema).min(1),
});

/// e.g. "7-avgust — Set 1, Set 3, Set 5" — dated so a teacher can tell
/// rounds apart at a glance; unit titles beyond the first 3 are collapsed
/// to a "+N" suffix rather than spelled out in full.
function buildHomeworkName(items: z.infer<typeof homeworkItemSchema>[]): string {
  const dateLabel = new Date().toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long' });
  const unitTitles = items.map((item) => item.unitTitle).filter((title): title is string => !!title);

  if (unitTitles.length === 0) return dateLabel;

  const shown = unitTitles.slice(0, 3).join(', ');
  const rest = unitTitles.length > 3 ? ` +${unitTitles.length - 3}` : '';
  return `${dateLabel} — ${shown}${rest}`;
}

corpHomeworkRouter.get('/', requireCenterStaff(), async (req, res) => {
  const group = await loadOwnedGroup(pstr(req.params.centerId), pstr(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.corpUser!.role === 'TEACHER' && group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  const homework = await prisma.homeworkAssignment.findMany({
    where: { groupId: group.id },
    orderBy: { assignedAt: 'asc' },
  });
  res.json(homework);
});

corpHomeworkRouter.post('/', requireCenterStaff({ role: 'TEACHER' }), async (req, res) => {
  const group = await loadOwnedGroup(pstr(req.params.centerId), pstr(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.teacherId !== req.corpUser!.id) {
    return res.status(403).json({ error: 'Not your group' });
  }

  const parsed = createHomeworkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const homework = await prisma.homeworkAssignment.create({
    data: {
      groupId: group.id,
      name: buildHomeworkName(parsed.data.items),
      items: parsed.data.items,
      assignedAt: new Date(),
    },
  });
  res.status(201).json(homework);
});
