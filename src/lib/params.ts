/// @types/express types every route param as `string | string[]` (to cover
/// wildcard segments), but none of our routes use wildcards — every named
/// param here is always a single string. This narrows it without an `as`
/// cast at every call site.
export function pstr(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}
