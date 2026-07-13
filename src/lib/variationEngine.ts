import { db } from "@/lib/db";
import { createHash } from "crypto";
import type { FeatureKey } from "@/lib/skillSystem";

interface VariationContext {
  orgId: string;
  featureKey: FeatureKey;
  format?: string;
  entityType?: string;
  entityId?: string;
}

export async function getVariationInstructions(ctx: VariationContext): Promise<string> {
  const fingerprints = await db.outputFingerprint.findMany({
    where: {
      organizationId: ctx.orgId,
      featureKey: ctx.featureKey,
      ...(ctx.format ? { format: ctx.format } : {}),
      ...(ctx.entityType && ctx.entityId ? { entityType: ctx.entityType, entityId: ctx.entityId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (fingerprints.length < 5) return "";

  // Count pattern frequencies
  const structureCounts = new Map<string, number>();
  const openingCounts = new Map<string, number>();
  const ctaCounts = new Map<string, number>();
  const headingCounts = new Map<string, number>();

  for (const fp of fingerprints) {
    structureCounts.set(fp.structureHash, (structureCounts.get(fp.structureHash) || 0) + 1);
    if (fp.openingPattern) openingCounts.set(fp.openingPattern, (openingCounts.get(fp.openingPattern) || 0) + 1);
    if (fp.ctaPattern) ctaCounts.set(fp.ctaPattern, (ctaCounts.get(fp.ctaPattern) || 0) + 1);
    for (const h of fp.headingPatterns) {
      headingCounts.set(h, (headingCounts.get(h) || 0) + 1);
    }
  }

  const overused: string[] = [];

  for (const [hash, count] of structureCounts) {
    if (count >= 3) overused.push(`- Avoid repeating the structural pattern "${hash}" (used ${count}/${fingerprints.length} recent outputs)`);
  }
  for (const [pattern, count] of openingCounts) {
    if (count >= 3) overused.push(`- Do NOT open with "${pattern}" or similar (used ${count} times recently)`);
  }
  for (const [pattern, count] of ctaCounts) {
    if (count >= 3) overused.push(`- Vary the CTA from "${pattern}" (used ${count} times recently)`);
  }
  for (const [heading, count] of headingCounts) {
    if (count >= 3) overused.push(`- Avoid the heading "${heading}" (used ${count} times recently)`);
  }

  if (overused.length === 0) return "";

  return `VARIATION RULES — avoid repetitive patterns:
${overused.join("\n")}
Try a different structural approach, opening hook, heading style, or CTA format than recent outputs.`;
}

interface FingerprintParams {
  orgId: string;
  featureKey: FeatureKey;
  format?: string;
  entityType?: string;
  entityId?: string;
  outputId?: string;
  content: string;
}

export async function fingerprintOutput(params: FingerprintParams): Promise<void> {
  try {
    const structure = analyzeStructure(params.content);
    const structureHash = createHash("md5").update(structure.template).digest("hex").slice(0, 12);

    await db.outputFingerprint.create({
      data: {
        featureKey: params.featureKey,
        format: params.format ?? null,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        structureHash,
        openingPattern: structure.opening ?? null,
        headingPatterns: structure.headings,
        ctaPattern: structure.cta ?? null,
        outputId: params.outputId ?? null,
        organizationId: params.orgId,
      },
    });

    // Prune fingerprints older than 90 days
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await db.outputFingerprint.deleteMany({
      where: { organizationId: params.orgId, createdAt: { lt: cutoff } },
    });
  } catch (e) {
    // Non-critical, but logged — the fingerprint table sat empty and nobody knew.
    console.error("fingerprintOutput failed:", e instanceof Error ? e.message : e);
  }
}

interface ContentStructure {
  template: string;
  opening: string | null;
  headings: string[];
  cta: string | null;
}

function analyzeStructure(content: string): ContentStructure {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);

  // Extract headings
  const headings = lines
    .filter(l => /^#{1,4}\s/.test(l))
    .map(l => l.replace(/^#+\s*/, "").toLowerCase().trim());

  // Build structural template: intro, headings, bullets, paragraphs, CTA
  const template = lines.map(l => {
    if (/^#{1,4}\s/.test(l)) return "H";
    if (/^[-*•]\s/.test(l) || /^\d+[.)]\s/.test(l)) return "L";
    if (l.length < 50) return "S";
    return "P";
  }).join("");

  // Opening pattern: first 20 words normalized
  const firstParagraph = lines.find(l => l.length > 30 && !/^[#\-*•\d]/.test(l));
  const opening = firstParagraph
    ? firstParagraph.split(/\s+/).slice(0, 8).join(" ").toLowerCase().replace(/[^a-z\s]/g, "").trim()
    : null;

  // CTA pattern: look for last action-oriented line
  const ctaPatterns = /\b(sign up|get started|learn more|try|download|subscribe|contact|book|schedule|start|join)\b/i;
  const lastLines = lines.slice(-5);
  const ctaLine = lastLines.find(l => ctaPatterns.test(l));
  const cta = ctaLine
    ? ctaLine.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).slice(0, 6).join(" ")
    : null;

  return { template, opening, headings, cta };
}
