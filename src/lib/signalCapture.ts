import { db } from "@/lib/db";
import type { FeatureKey, SignalType } from "@/lib/skillSystem";

interface SignalParams {
  orgId: string;
  signalType: SignalType;
  featureKey: FeatureKey;
  outputId?: string;
  entityType?: "product" | "persona" | "market" | "competitor";
  entityId?: string;
  /** Entity display name (e.g. the product name from a form). When entityId is
   * absent, it is resolved to an id here so the skill refiner can group signals
   * per entity — signals without entityId can never trigger refinement. */
  entityName?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
}

async function resolveEntityId(
  orgId: string,
  entityType: string,
  entityName: string,
): Promise<string | null> {
  const name = entityName.trim();
  if (!name) return null;
  try {
    switch (entityType) {
      case "product": {
        const p = await db.product.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
        return p?.id ?? null;
      }
      case "persona": {
        const p = await db.persona.findFirst({ where: { organizationId: orgId, title: { equals: name, mode: "insensitive" } }, select: { id: true } });
        return p?.id ?? null;
      }
      case "market": {
        const m = await db.market.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
        return m?.id ?? null;
      }
      case "competitor": {
        const c = await db.competitor.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
        return c?.id ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export async function recordSignal(params: SignalParams): Promise<void> {
  try {
    let entityId = params.entityId ?? null;
    let entityType = params.entityType ?? null;
    if (!entityId && entityType && params.entityName) {
      entityId = await resolveEntityId(params.orgId, entityType, params.entityName);
    }
    if (!entityId) entityType = null; // never store a type without an id

    await db.usageSignal.create({
      data: {
        signalType: params.signalType,
        featureKey: params.featureKey,
        outputId: params.outputId ?? null,
        entityType,
        entityId,
        metadata: (params.metadata ?? {}) as Record<string, string | number | boolean | null>,
        userId: params.userId ?? null,
        organizationId: params.orgId,
      },
    });
  } catch (e) {
    // Non-critical, but not invisible — dead signal capture hid for weeks behind a bare catch
    console.error("recordSignal failed:", e instanceof Error ? e.message : e);
  }
}
