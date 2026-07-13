/**
 * Runs once at server startup (Next.js instrumentation hook).
 *
 * Fail closed on missing secrets: JWT signing and BYOK key encryption both
 * had hardcoded fallback values ("fallback-secret"), which meant a missing
 * env var silently made every auth token forgeable and every stored API key
 * decryptable with publicly-known constants. Refuse to boot instead.
 */
export async function register() {
  if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.trim().length < 16) {
    throw new Error(
      "FATAL: NEXTAUTH_SECRET is missing or too short (<16 chars). " +
      "Refusing to start — JWTs would be signed with a publicly-known fallback secret."
    );
  }
}
