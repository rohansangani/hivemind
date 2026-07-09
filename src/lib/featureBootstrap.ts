/**
 * Feature Bootstrap — auto-registers AI features with the skill system on first use.
 * Fire-and-forget upsert; never blocks the main request path.
 */

import { db } from "@/lib/db";
import { FEATURE_DEFINITIONS, type FeatureKey } from "@/lib/skillSystem";

export async function ensureFeatureRegistered(orgId: string, featureKey: FeatureKey): Promise<void> {
  const def = FEATURE_DEFINITIONS[featureKey];
  if (!def) return;

  try {
    await db.featureRegistry.upsert({
      where: { organizationId_key: { organizationId: orgId, key: featureKey } },
      create: {
        key: featureKey,
        name: def.name,
        skillCategories: def.skillCategories,
        organizationId: orgId,
      },
      update: {},
    });
  } catch {
    // Non-critical — swallow errors silently
  }
}
