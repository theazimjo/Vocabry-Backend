import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './middleware/auth.js';
import { requireSuperAdmin } from './middleware/roles.js';
import { adminRouter } from './routes/admin.js';
import { announcementsRouter } from './routes/announcements.js';
import { corpRouter } from './routes/corp.js';
import { errorsRouter } from './routes/errors.js';
import { foldersRouter } from './routes/folders.js';
import { grammarRouter } from './routes/grammar.js';
import { groupsRouter } from './routes/groups.js';
import { meRouter } from './routes/me.js';
import { packsRouter } from './routes/packs.js';

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/me', requireAuth, meRouter);
app.use('/folders', requireAuth, foldersRouter);
app.use('/packs', requireAuth, packsRouter);
app.use('/groups', requireAuth, groupsRouter);
app.use('/corp', requireAuth, corpRouter);
app.use('/grammar', requireAuth, grammarRouter);
app.use('/errors', requireAuth, errorsRouter);
app.use('/announcements', requireAuth, announcementsRouter);
app.use('/admin', requireAuth, requireSuperAdmin, adminRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`voc-backend listening on :${port}`));
