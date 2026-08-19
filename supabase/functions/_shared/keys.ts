// Resolving Supabase API keys across the legacy → publishable/secret migration.
//
// Supabase is retiring the legacy `anon` / `service_role` JWTs (end of 2026) in
// favour of `sb_publishable_…` / `sb_secret_…`. The legacy JWT secret can no
// longer be rotated, so the ONLY way to neutralise a leaked `service_role` key
// is to migrate every consumer onto a secret key and then disable the legacy
// key in the dashboard.
//
// Edge Functions receive the new keys as **JSON dictionaries keyed by name**
// (`SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`) — not bare strings —
// while the legacy `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` are still
// injected until legacy keys are disabled.
//
// These helpers prefer the new keys and fall back to the legacy ones, so the
// functions keep working both BEFORE the migration and AFTER legacy keys are
// switched off. Once legacy is disabled and confirmed dead, the fallbacks can
// be deleted.

const readKeyDict = (raw: string | undefined, varName: string): string | null => {
  if (!raw) return null;
  try {
    const dict = JSON.parse(raw) as Record<string, unknown>;
    // 'default' is the key created by the migration; fall back to the first
    // entry so a project that named its key something else still works.
    const value = dict.default ?? Object.values(dict)[0];
    return typeof value === "string" && value ? value : null;
  } catch {
    console.warn(`${varName} is set but is not valid JSON; ignoring it.`);
    return null;
  }
};

/** Elevated, RLS-bypassing key. Never send this to a browser. */
export const getSecretKey = (): string =>
  readKeyDict(Deno.env.get("SUPABASE_SECRET_KEYS"), "SUPABASE_SECRET_KEYS") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";

/** Low-privilege key, safe in public contexts; RLS still applies. */
export const getPublishableKey = (): string =>
  readKeyDict(
    Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
    "SUPABASE_PUBLISHABLE_KEYS",
  ) ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    "";

/**
 * True when `token` is one of our own API keys rather than a signed-in user's
 * JWT. Checks both the new and legacy values, because a client mid-migration
 * may still be sending the legacy one.
 */
export const isProjectApiKey = (token: string): boolean =>
  !!token &&
  (token === getPublishableKey() ||
    token === Deno.env.get("SUPABASE_ANON_KEY") ||
    token === getSecretKey() ||
    token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
