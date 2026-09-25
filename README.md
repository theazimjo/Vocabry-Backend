# voc-backend

API backend for [VOC](https://github.com/theazimjo/VOC), replacing Firebase Realtime Database as the data layer. Firebase Auth stays as-is on the frontend — this service only verifies the ID tokens it already issues.

## Why this exists

VOC's Firebase RTDB security rules had to re-derive authorization (e.g. "is this user a member of this group?") from data the *client* itself was allowed to write, because RTDB rules have no server-side code to fall back on. That made it possible to forge membership and read other centers' data. Moving the data layer here fixes the underlying issue rather than patching the symptom: every authorization check in this repo is a plain `WHERE userId = req.uid` (or similar) query against tables no client endpoint lets you write arbitrary values into — see the comments on `GroupMembership` in `prisma/schema.prisma` and `POST /groups/join` in `src/routes/groups.ts` for the concrete before/after.

## Stack

Node.js + TypeScript, Express, Prisma, PostgreSQL, Firebase Admin SDK (token verification only).

## Status

Skeleton — not yet wired up to the VOC frontend. Implemented so far: auth middleware, `User`/`Pack`/`Folder`/`Word` (personal library) and `Center`/`CorpUser`/`Group`/`GroupMembership`/`CorpPack` (learning-center platform) models, and example routes (`/me`, `/packs`, `/groups`). Everything else in VOC's RTDB tree (grammar attempts, error logs, teacher invites, announcements, ...) still needs modeling and porting — do that incrementally, one Firebase read/write call site at a time, not as one big migration.

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
