/**
 * Radar-only mode: the app shows just Radar plus the admin pages (Team, Activity, Usage, Settings).
 * Every other HiveMind module is hidden from the navigation and its URLs redirect to Radar. Nothing is deleted —
 * set RADAR_ONLY to false to bring the full HiveMind navigation back.
 */
export const RADAR_ONLY = true;

/** Route prefixes that stay reachable in Radar-only mode. */
export const RADAR_ONLY_ALLOWED = ["/radar", "/team", "/activity", "/usage", "/settings", "/view"];

export function isAllowedInRadarOnly(pathname: string): boolean {
  return RADAR_ONLY_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
