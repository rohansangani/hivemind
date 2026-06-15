import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { hasPermission } from "@/lib/permissions";
import {
  getConfiguredProviders,
  saveProviderKey,
  removeProviderKey,
  validateProviderKey,
  type AIProvider,
  PROVIDER_META,
} from "@/lib/aiProvider";

function getAuth(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
      role?: string;
    };
  } catch {
    return null;
  }
}

// ── GET — list configured providers for the workspace ──────────────────────

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const providers = await getConfiguredProviders(auth.orgId);

  // Return provider status (never return the actual key)
  return NextResponse.json({
    providers: providers.map((p) => ({
      provider: p.provider,
      keyHint: p.keyHint,
      isActive: p.isActive,
      modelOverride: p.modelOverride,
      updatedAt: p.updatedAt,
    })),
    available: Object.entries(PROVIDER_META).map(([id, meta]) => ({
      id,
      label: meta.label,
      color: meta.color,
      placeholder: meta.placeholder,
      helpUrl: meta.helpUrl,
      defaultModel: meta.defaultModel,
      configured: providers.some((p) => p.provider === id && p.isActive),
    })),
  });
}

// ── POST — save or validate a provider key ─────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Only owner/admin can manage API keys
  if (!hasPermission(auth.role || "viewer", "manage_settings")) {
    return NextResponse.json({ error: "Only admins can manage AI provider keys" }, { status: 403 });
  }

  const body = await req.json();
  const { provider, apiKey, modelOverride, action } = body as {
    provider: AIProvider;
    apiKey: string;
    modelOverride?: string;
    action?: "validate" | "save";
  };

  if (!provider || !apiKey) {
    return NextResponse.json({ error: "provider and apiKey are required" }, { status: 400 });
  }

  if (!PROVIDER_META[provider]) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  // Validate the key first
  const validation = await validateProviderKey(provider, apiKey);

  if (action === "validate") {
    return NextResponse.json(validation);
  }

  if (!validation.valid) {
    return NextResponse.json(
      { success: false, error: validation.error || "Invalid API key" },
      { status: 400 }
    );
  }

  // Save the key
  await saveProviderKey(auth.orgId, provider, apiKey, modelOverride);

  return NextResponse.json({
    success: true,
    message: `${PROVIDER_META[provider].label} API key saved and verified.`,
  });
}

// ── DELETE — remove a provider key ─────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!hasPermission(auth.role || "viewer", "manage_settings")) {
    return NextResponse.json({ error: "Only admins can manage AI provider keys" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider") as AIProvider;

  if (!provider || !PROVIDER_META[provider]) {
    return NextResponse.json({ error: "Valid provider is required" }, { status: 400 });
  }

  await removeProviderKey(auth.orgId, provider);

  return NextResponse.json({
    success: true,
    message: `${PROVIDER_META[provider].label} disconnected.`,
  });
}
