import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

export const meRouter = Router();

meRouter.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.uid },
    include: { corpUser: true },
  });
  res.json(user);
});
