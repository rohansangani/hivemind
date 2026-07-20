import { db } from "@/lib/db";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * Server-side authorization helpers that read the role FRESH from the database
 * rather than trusting the role baked into the 30-day JWT.
 *
 * The JWT's `role` claim is snapshotted at login and never refreshes until the
 * user logs out — so a demoted admin keeps admin powers for up to 30 days if a
 * route gates on `decoded.role`. Privileged mutation routes must use these
 * helpers instead.
 */

/** Fetch the user's current role from the DB. Returns null if the user is gone. */
export async function getCurrentRole(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role ?? null;
}

/**
 * True if the user currently holds `permission`, checked against the live DB role.
 * Use in privileged routes: `if (!(await currentUserHasPermission(userId, "manage_settings"))) return 403`.
 */
export async function currentUserHasPermission(userId: string, permission: Permission): Promise<boolean> {
  const role = await getCurrentRole(userId);
  if (!role) return false;
  return hasPermission(role, permission);
}

/** Coach ownership (generate / enroll / team dashboard) — owner & admin only. */
export async function canManageCoach(userId: string): Promise<boolean> {
  return currentUserHasPermission(userId, "manage_team");
}

/** Coach learning access — an enrolled user, or an admin/owner who owns the module. */
export async function hasCoachAccess(userId: string): Promise<boolean> {
  const enrolled = await db.coachEnrollment.findUnique({ where: { userId }, select: { id: true } });
  if (enrolled) return true;
  return canManageCoach(userId);
}
