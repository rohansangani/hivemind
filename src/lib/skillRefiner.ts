import { db } from "@/lib/db";
import { getAnthropicKey } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import type { SkillCategory } from "@/lib/skillSystem";

const MIN_SIGNALS_FOR_REFINEMENT = 5;

interface SignalGroup {
  entityType: string;
  entityId: string;
  entityName: string;
  signals: Array<{
    signalType: string;
    featureKey: string;
    metadata: Record<string, unknown>;
  }>;
}

export async function refineSkillsFromSignals(orgId: string): Promise<{ refined: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const recentSignals = await db.usageSignal.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  if (recentSignals.length < MIN_SIGNALS_FOR_REFINEMENT) {
    return { refined: 0 };
  }

  // Group signals by entity
  const entityGroups = new Map<string, { entityType: string; entityId: string; signals: typeof recentSignals }>();
  for (const signal of recentSignals) {
    if (!signal.entityType || !signal.entityId) continue;
    const key = `${signal.entityType}:${signal.entityId}`;
    if (!entityGroups.has(key)) {
      entityGroups.set(key, { entityType: signal.entityType, entityId: signal.entityId, signals: [] });
    }
    entityGroups.get(key)!.signals.push(signal);
  }

  // Only refine entities with enough signals
  const eligibleGroups: SignalGroup[] = [];
  for (const [, group] of entityGroups) {
    if (group.signals.length < MIN_SIGNALS_FOR_REFINEMENT) continue;

    const entityName = await resolveEntityName(orgId, group.entityType, group.entityId);
    if (!entityName) continue;

    eligibleGroups.push({
      entityType: group.entityType,
      entityId: group.entityId,
      entityName,
      signals: group.signals.map(s => ({
        signalType: s.signalType,
        featureKey: s.featureKey,
        metadata: (s.metadata as Record<string, unknown>) ?? {},
      })),
    });
  }

  if (eligibleGroups.length === 0) return { refined: 0 };

  let apiKey: string;
  try {
    apiKey = await getAnthropicKey(orgId);
  } catch {
    return { refined: 0 };
  }

  let refined = 0;
  for (const group of eligibleGroups) {
    const success = await refineEntitySkill(orgId, apiKey, group);
    if (success) refined++;
  }

  return { refined };
}

async function refineEntitySkill(
  orgId: string,
  apiKey: string,
  group: SignalGroup,
): Promise<boolean> {
  const positive = group.signals.filter(s => s.signalType === "feedback_positive" || s.signalType === "used").length;
  const negative = group.signals.filter(s => s.signalType === "feedback_negative" || s.signalType === "discarded" || s.signalType === "regenerated").length;
  const total = positive + negative;
  const confidence = total > 0 ? Math.min(1, positive / total) : 0.5;

  const categoryMap: Record<string, SkillCategory> = {
    product: "product",
    persona: "persona",
    market: "market",
    competitor: "competitor",
  };
  const category = categoryMap[group.entityType] ?? "general";

  const signalSummary = group.signals
    .slice(0, 20)
    .map(s => `- ${s.signalType} in ${s.featureKey}${s.metadata?.topic ? ` (topic: ${s.metadata.topic})` : ""}`)
    .join("\n");

  const prompt = `Based on usage patterns for "${group.entityName}" (${group.entityType}), write a concise skill instruction (100-150 words) that tells an AI assistant how to create the best content involving this ${group.entityType}.

Usage signals (${group.signals.length} total, ${positive} positive, ${negative} negative):
${signalSummary}

Write ONLY the instruction text. Start with "When creating content about ${group.entityName}:". Focus on what works well and what to avoid based on the signal patterns.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { return false; }
    if (!res.ok) return false;

    const instructions = data.content?.[0]?.type === "text" ? data.content[0].text.trim() : null;
    if (!instructions) return false;

    const usage = extractAnthropicUsage(data);
    if (usage) {
      logTokenUsage({ feature: "skills", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, organizationId: orgId });
    }

    const existing = await db.skillV2.findFirst({
      where: { organizationId: orgId, entityType: group.entityType, entityId: group.entityId, scope: "entity", isSynthesized: true },
    });

    if (existing) {
      await db.skillV2.update({
        where: { id: existing.id },
        data: {
          instructions,
          confidence,
          sourceCount: group.signals.length,
          version: existing.version + 1,
        },
      });
    } else {
      await db.skillV2.create({
        data: {
          name: `${group.entityName} — ${group.entityType} skill`,
          instructions,
          scope: "entity",
          category,
          entityType: group.entityType,
          entityId: group.entityId,
          isActive: true,
          isSynthesized: true,
          confidence,
          sourceCount: group.signals.length,
          organizationId: orgId,
        },
      });
    }

    return true;
  } catch {
    return false;
  }
}

async function resolveEntityName(orgId: string, entityType: string, entityId: string): Promise<string | null> {
  try {
    switch (entityType) {
      case "product": {
        const p = await db.product.findFirst({ where: { id: entityId, organizationId: orgId }, select: { name: true } });
        return p?.name ?? null;
      }
      case "persona": {
        const p = await db.persona.findFirst({ where: { id: entityId, organizationId: orgId }, select: { title: true } });
        return p?.title ?? null;
      }
      case "market": {
        const m = await db.market.findFirst({ where: { id: entityId, organizationId: orgId }, select: { name: true } });
        return m?.name ?? null;
      }
      case "competitor": {
        const c = await db.competitor.findFirst({ where: { id: entityId, organizationId: orgId }, select: { name: true } });
        return c?.name ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
