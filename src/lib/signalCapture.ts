import { db } from "@/lib/db";
import type { FeatureKey, SignalType } from "@/lib/skillSystem";

interface SignalParams {
  orgId: string;
  signalType: SignalType;
  featureKey: FeatureKey;
  outputId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
}

export async function recordSignal(params: SignalParams): Promise<void> {
  try {
    await db.usageSignal.create({
      data: {
        signalType: params.signalType,
        featureKey: params.featureKey,
        outputId: params.outputId ?? null,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata: (params.metadata ?? {}) as Record<string, string | number | boolean | null>,
        userId: params.userId ?? null,
        organizationId: params.orgId,
      },
    });
  } catch {
    // Non-critical — swallow errors silently
  }
}
