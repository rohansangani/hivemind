/**
 * AI Provider configuration — BYOK (Bring Your Own Key) support
 *
 * Each workspace stores their own encrypted API keys for AI providers.
 * No fallback to a shared key — workspaces must configure their own.
 *
 * Supported providers: anthropic, openai, google
 */

import { db } from "@/lib/db";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────
//  Encryption (AES-256-GCM)
// ─────────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.AI_KEY_ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET || "fallback-encryption-key-change-me";

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, "hivemind-ai-keys", 32);
}

export function encryptApiKey(plaintext: string): string {
  const key = deriveKey(ENCRYPTION_KEY);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptApiKey(ciphertext: string): string {
  const key = deriveKey(ENCRYPTION_KEY);
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) throw new Error("Invalid encrypted key format");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function maskKey(apiKey: string): string {
  if (apiKey.length <= 4) return "••••";
  return "••••" + apiKey.slice(-4);
}

// ─────────────────────────────────────────────────────────
//  Provider types
// ─────────────────────────────────────────────────────────

export type AIProvider = "anthropic" | "openai" | "google";

export const PROVIDER_META: Record<AIProvider, { label: string; color: string; placeholder: string; helpUrl: string; defaultModel: string }> = {
  anthropic: {
    label: "Anthropic (Claude)",
    color: "#D97706",
    placeholder: "sk-ant-api03-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-4-6",
  },
  openai: {
    label: "OpenAI (GPT)",
    color: "#10A37F",
    placeholder: "sk-proj-...",
    helpUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o",
  },
  google: {
    label: "Google (Gemini)",
    color: "#4285F4",
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.5-flash",
  },
};

// ─────────────────────────────────────────────────────────
//  Core functions
// ─────────────────────────────────────────────────────────

/**
 * Get the decrypted API key for a provider + org.
 * Returns null if not configured or inactive.
 */
export async function getProviderKey(
  orgId: string,
  provider: AIProvider = "anthropic"
): Promise<string | null> {
  const config = await db.aIProviderConfig.findUnique({
    where: { organizationId_provider: { organizationId: orgId, provider } },
  });
  if (!config || !config.isActive) return null;
  try {
    return decryptApiKey(config.encryptedKey);
  } catch {
    return null;
  }
}

/**
 * Get an Anthropic client for a workspace.
 * Throws if no key is configured.
 */
export async function getAnthropicClient(orgId: string): Promise<Anthropic> {
  const apiKey = await getProviderKey(orgId, "anthropic");
  if (!apiKey) {
    throw new AIKeyNotConfiguredError("anthropic");
  }
  return new Anthropic({ apiKey });
}

/**
 * Get the Anthropic API key for a workspace (for raw fetch calls).
 * Throws if no key is configured.
 */
export async function getAnthropicKey(orgId: string): Promise<string> {
  const apiKey = await getProviderKey(orgId, "anthropic");
  if (!apiKey) {
    throw new AIKeyNotConfiguredError("anthropic");
  }
  return apiKey;
}

/**
 * Check whether a workspace has a given provider configured.
 */
export async function hasProviderConfigured(
  orgId: string,
  provider: AIProvider = "anthropic"
): Promise<boolean> {
  const config = await db.aIProviderConfig.findUnique({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    select: { isActive: true },
  });
  return !!config?.isActive;
}

/**
 * Get all configured providers for a workspace.
 */
export async function getConfiguredProviders(orgId: string) {
  const configs = await db.aIProviderConfig.findMany({
    where: { organizationId: orgId },
    select: { provider: true, keyHint: true, isActive: true, modelOverride: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return configs;
}

/**
 * Save (upsert) an API key for a provider.
 */
export async function saveProviderKey(
  orgId: string,
  provider: AIProvider,
  apiKey: string,
  modelOverride?: string
) {
  const encryptedKey = encryptApiKey(apiKey);
  const keyHint = maskKey(apiKey);

  return db.aIProviderConfig.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    create: {
      provider,
      encryptedKey,
      keyHint,
      isActive: true,
      modelOverride: modelOverride || null,
      organizationId: orgId,
    },
    update: {
      encryptedKey,
      keyHint,
      isActive: true,
      modelOverride: modelOverride || undefined,
      updatedAt: new Date(),
    },
  });
}

/**
 * Remove a provider key from a workspace.
 */
export async function removeProviderKey(orgId: string, provider: AIProvider) {
  return db.aIProviderConfig.deleteMany({
    where: { organizationId: orgId, provider },
  });
}

// ─────────────────────────────────────────────────────────
//  Validation — test that a key actually works
// ─────────────────────────────────────────────────────────

export async function validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok) return { valid: true };
    const data = await res.json().catch(() => ({}));
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) return { valid: false, error: "Invalid API key" };
    if (res.status === 403) return { valid: false, error: "API key lacks required permissions" };
    return { valid: false, error: msg };
  } catch (err) {
    return { valid: false, error: `Connection failed: ${(err as Error).message}` };
  }
}

export async function validateOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { valid: true };
    if (res.status === 401) return { valid: false, error: "Invalid API key" };
    const data = await res.json().catch(() => ({}));
    return { valid: false, error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { valid: false, error: `Connection failed: ${(err as Error).message}` };
  }
}

export async function validateGoogleKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (res.ok) return { valid: true };
    if (res.status === 400 || res.status === 403) return { valid: false, error: "Invalid API key" };
    const data = await res.json().catch(() => ({}));
    return { valid: false, error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { valid: false, error: `Connection failed: ${(err as Error).message}` };
  }
}

export async function validateProviderKey(
  provider: AIProvider,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  switch (provider) {
    case "anthropic":
      return validateAnthropicKey(apiKey);
    case "openai":
      return validateOpenAIKey(apiKey);
    case "google":
      return validateGoogleKey(apiKey);
    default:
      return { valid: false, error: `Unknown provider: ${provider}` };
  }
}

// ─────────────────────────────────────────────────────────
//  Error class
// ─────────────────────────────────────────────────────────

export class AIKeyNotConfiguredError extends Error {
  provider: string;
  constructor(provider: string) {
    super(
      `No ${PROVIDER_META[provider as AIProvider]?.label || provider} API key configured for this workspace. Ask your workspace admin to add one in Settings > Integrations.`
    );
    this.name = "AIKeyNotConfiguredError";
    this.provider = provider;
  }
}
