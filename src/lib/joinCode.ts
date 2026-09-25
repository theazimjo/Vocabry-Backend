/// Generates a random 6-digit PIN. Uniqueness against a given Prisma model
/// is the caller's job (see routes/corp.ts, routes/groups.ts) — this just
/// produces candidates.
export function randomJoinCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
