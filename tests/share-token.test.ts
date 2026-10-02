import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateShareToken, hashShareToken, isWellFormedShareToken } from "@/lib/share-token";

describe("token de partage", () => {
  it("32 octets aléatoires en base64url (43 caractères)", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(isWellFormedShareToken(token)).toBe(true);
  });

  it("jamais deux fois le même", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateShareToken));
    expect(tokens.size).toBe(1000);
  });

  it("hash HMAC-SHA256 hexadécimal, déterministe et dépendant du pepper", () => {
    const token = generateShareToken();
    const hash = hashShareToken(token, "pepper-1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token, "pepper-1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toBe(hash);
    expect(hashShareToken(token, "pepper-2-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")).not.toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("refuse un pepper vide", () => {
    expect(() => hashShareToken(generateShareToken(), "")).toThrow();
  });
});

// --- Actions de gestion du lien -------------------------------------------

const calls: string[] = [];
const insert = vi.fn<(row: { token_hash: string }) => Promise<{ error: null }>>(async () => {
  calls.push("insert");
  return { error: null };
});
const update = vi.fn(() => ({
  is: async () => {
    calls.push("revoke");
    return { error: null };
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ supabase: { from: () => ({ insert, update }) } })),
}));
vi.mock("@/lib/request-origin", () => ({ requestOrigin: async () => "https://eau.example.app" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("action generateShareLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    vi.stubEnv("SHARE_TOKEN_PEPPER", "pepper-de-test-suffisamment-long-0123456789");
  });

  it("révoque l'ancien lien, stocke seulement le hash et renvoie l'URL complète une fois", async () => {
    const { generateShareLink } = await import("@/app/(admin)/parametres/actions");
    const { requireAdmin } = await import("@/lib/auth");
    const state = await generateShareLink();
    expect(requireAdmin).toHaveBeenCalled();
    expect(calls).toEqual(["revoke", "insert"]);
    expect(state.status).toBe("created");
    const url = state.status === "created" ? state.url : "";
    const token = url.replace("https://eau.example.app/p/", "");
    expect(isWellFormedShareToken(token)).toBe(true);
    const stored = insert.mock.calls[0]![0];
    expect(stored).toEqual({ token_hash: hashShareToken(token, "pepper-de-test-suffisamment-long-0123456789") });
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("refuse de fonctionner sans pepper (échec fermé)", async () => {
    vi.stubEnv("SHARE_TOKEN_PEPPER", "");
    const { generateShareLink } = await import("@/app/(admin)/parametres/actions");
    await expect(generateShareLink()).rejects.toThrow("SHARE_TOKEN_PEPPER");
    expect(insert).not.toHaveBeenCalled();
  });
});
