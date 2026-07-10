/**
 * Admin-only Radar activity log — write/run actions only (edits, mark
 * irrelevant/unmark, permanent delete, uploads, exports, Validate/Enrich/
 * Check LinkedIn runs). Deliberately excludes read/browse activity.
 */

export async function logRadarActivity(userId: string, action: string, summary: string): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.radarActivityLog.create({ data: { userId, action, summary } });
  } catch (e) {
    console.error("Radar activity log error:", e);
  }
}
