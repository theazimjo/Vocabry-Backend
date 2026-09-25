# voc-backend

API backend for [VOC](https://github.com/theazimjo/VOC), replacing Firebase Realtime Database as the data layer. Firebase Auth stays as-is on the frontend — this service only verifies the ID tokens it already issues.

## Why this exists

VOC's Firebase RTDB security rules had to re-derive authorization (e.g. "is this user a member of this group?") from data the *client* itself was allowed to write, because RTDB rules have no server-side code to fall back on. That made it possible to forge membership and read other centers' data. Moving the data layer here fixes the underlying issue rather than patching the symptom: every authorization check in this repo is a plain `WHERE userId = req.uid` (or similar) query against tables no client endpoint lets you write arbitrary values into — see the comments on `GroupMembership` in `prisma/schema.prisma` and `POST /groups/join` in `src/routes/groups.ts` for the concrete before/after.

## Stack

Node.js + TypeScript, Express, Prisma, PostgreSQL, Firebase Admin SDK (token verification only).

## Status

Not yet wired up to the VOC frontend, but most of VOC's RTDB tree is now modeled and routed:

| Domain | Routes | Notes |
| --- | --- | --- |
| Auth | — | `requireAuth` (`src/middleware/auth.ts`) verifies the Firebase ID token, upserts `User` |
| Personal library | `/me`, `/folders`, `/packs`, `/packs/:packId/words` | full CRUD |
| Word target | `PATCH /me/word-target` | |
| Groups (student-facing) | `POST /groups/join`, `GET /groups/:groupId`, `PATCH /groups/:groupId/me` | join by PIN, self-service roster/progress update |
| Super admin | `/admin/centers`, `/admin/centers/:id/admin-account`, `/admin/corp-users` | creates centers + center-admin Firebase accounts via Admin SDK |
| Center (staff) | `GET /corp/centers/:id`, `/corp/centers/:id/teachers`, `/corp/centers/:id/teacher-join-code[/regenerate]` | |
| Teacher join flow | `/corp/join-requests`, `/corp/centers/:id/join-requests[/:uid/approve\|reject]` | self-service request → center_admin approval |
| Groups (staff-facing) | `/corp/centers/:id/groups`, `.../:groupId/students`, `.../:groupId` (patch) | teacher sees own groups, center_admin sees all |
| Custom packs | `/corp/centers/:id/packs`, `.../:packId/assign/:groupId` | shared or teacher-private, assignable to groups |
| Homework | `/corp/centers/:id/groups/:groupId/homework` | additive rounds, auto-named |
| Grammar attempts | `/grammar/attempts[/me]` | student submits, super admin scores |
| Error logs | `POST /errors`, `GET /errors` (super admin) | |
| Announcements | `/announcements/active`, `/announcements` (super admin CRUD) | role-targeted |

Still missing: reading/porting the memory engine's own data (word stats, spaced-repetition state — `src/utils/memoryEngine.js` and friends in the VOC repo aren't backend concerns yet, they run client-side against whatever store eventually holds word review history), and the actual frontend migration below.

## Local setup

```bash
cp .env.example .env      # then fill in FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
                           # from Firebase Console > Project Settings > Service accounts
docker compose up -d      # starts local Postgres on :5432
npm install
npm run prisma:migrate    # creates the schema in Postgres
npm run dev                # http://localhost:4000
```

`GET /health` needs no auth. Every other route needs `Authorization: Bearer <firebase-id-token>` — grab one from the VOC frontend's browser console with `await firebase.auth().currentUser.getIdToken()`.

## Adding an endpoint

1. Add/extend a model in `prisma/schema.prisma`, run `npm run prisma:migrate`.
2. Add a route file under `src/routes/`, scope every query to `req.uid` (set by `requireAuth`) or to a row you've already confirmed `req.uid` has rights to.
3. Validate the request body with a `zod` schema before touching the database — see `src/routes/packs.ts`.
4. Register the router in `src/index.ts`.

## Connecting the VOC frontend

Not done yet. When it's time: replace the relevant Firebase `get`/`set`/`onValue` calls in `VOC/src/services/*.js` with `fetch` calls to this API, sending the Firebase ID token in the `Authorization` header. Migrate one data domain at a time (e.g. personal packs first) so both the RTDB and this API can run side by side during the transition.
