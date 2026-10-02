import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHOTO_PATH_PATTERN, deliveryInputSchema } from "@/lib/delivery-input";

const TODAY = "2026-10-02";
const schema = deliveryInputSchema(TODAY);

describe("validation d'une nouvelle livraison", () => {
  it("accepte une saisie complète et normalise la note", () => {
    const result = schema.parse({
      deliveryDate: "2026-10-01",
      bottlesA: 2,
      bottlesB: 3,
      note: "  bon n°42  ",
      photoPath: "2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg",
    });
    expect(result).toEqual({
      deliveryDate: "2026-10-01",
      bottlesA: 2,
      bottlesB: 3,
      note: "bon n°42",
      photoPath: "2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg",
    });
  });

  it("note vide et photo absente → null", () => {
    const result = schema.parse({ deliveryDate: TODAY, bottlesA: 0, bottlesB: 1, note: "   " });
    expect(result.note).toBeNull();
    expect(result.photoPath).toBeNull();
  });

  it.each([
    [{ deliveryDate: TODAY, bottlesA: 0, bottlesB: 0 }, "Indiquez au moins une bonbonne"],
    [{ deliveryDate: TODAY, bottlesA: -1, bottlesB: 2 }, "Nombre de bonbonnes invalide"],
    [{ deliveryDate: TODAY, bottlesA: 1.5, bottlesB: 2 }, "Nombre de bonbonnes invalide"],
    [{ deliveryDate: TODAY, bottlesA: 100, bottlesB: 0 }, "Au plus 99 bonbonnes"],
    [{ deliveryDate: "2026-10-03", bottlesA: 1, bottlesB: 1 }, "La date de livraison ne peut pas être dans le futur"],
    [{ deliveryDate: "2026-02-30", bottlesA: 1, bottlesB: 1 }, "Date invalide"],
    [{ deliveryDate: TODAY, bottlesA: 1, bottlesB: 1, note: "x".repeat(501) }, "Note limitée à 500 caractères"],
  ])("refuse %o", (input, message) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message);
  });

  it("refuse un chemin de photo arbitraire (pas de référence à un autre fichier)", () => {
    for (const photoPath of [
      "../secret.jpg",
      "2026/../../x.jpg",
      "autre-bucket/x.jpg",
      "2026/0f8fad5b-d9cb-469f-a165-70867728950e.exe",
      "2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg/../x",
    ]) {
      expect(PHOTO_PATH_PATTERN.test(photoPath), photoPath).toBe(false);
      expect(schema.safeParse({ deliveryDate: TODAY, bottlesA: 1, bottlesB: 0, photoPath }).success).toBe(false);
    }
  });

  it("ignore tout prix envoyé par le client", () => {
    const result = schema.parse({
      deliveryDate: TODAY,
      bottlesA: 1,
      bottlesB: 1,
      unitPriceCentsApplied: 1,
    } as never);
    expect(result).not.toHaveProperty("unitPriceCentsApplied");
  });
});

// --- Server Actions --------------------------------------------------------

const insert = vi.fn();
const remove = vi.fn(async () => ({ data: [], error: null }));
const deleteSelect = vi.fn();

const fakeSupabase = {
  from: vi.fn(() => ({
    insert,
    delete: () => ({ eq: () => ({ select: deleteSelect }) }),
  })),
  storage: { from: vi.fn(() => ({ remove })) },
};

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ supabase: fakeSupabase, user: { email: "admin@example.com" } })),
}));
vi.mock("@/lib/dates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dates")>()),
  todayIso: () => TODAY,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

describe("action createDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("vérifie l'admin, insère sans prix (figé par la base) puis redirige", async () => {
    insert.mockResolvedValueOnce({ error: null });
    const { createDelivery } = await import("@/app/(admin)/livraisons/nouvelle/actions");
    const { requireAdmin } = await import("@/lib/auth");
    await expect(
      createDelivery({ deliveryDate: "2026-10-01", bottlesA: 2, bottlesB: 3, note: "", photoPath: null }),
    ).rejects.toThrow("REDIRECT:/?ok=livraison");
    expect(requireAdmin).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      delivery_date: "2026-10-01",
      bottles_a: 2,
      bottles_b: 3,
      note: null,
      photo_path: null,
    });
  });

  it("refuse une saisie invalide sans toucher à la base", async () => {
    const { createDelivery } = await import("@/app/(admin)/livraisons/nouvelle/actions");
    const result = await createDelivery({ deliveryDate: "2026-10-01", bottlesA: 0, bottlesB: 0 });
    expect(result).toEqual({ ok: false, error: "Indiquez au moins une bonbonne" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("supprime la photo envoyée si l'insertion échoue", async () => {
    insert.mockResolvedValueOnce({ error: { message: "Aucun prix unitaire en vigueur au 2026-10-01" } });
    const { createDelivery } = await import("@/app/(admin)/livraisons/nouvelle/actions");
    const photoPath = "2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
    const result = await createDelivery({ deliveryDate: "2026-10-01", bottlesA: 1, bottlesB: 1, photoPath });
    expect(result).toEqual({ ok: false, error: "Aucun prix unitaire n'est en vigueur à cette date (voir Réglages)." });
    expect(remove).toHaveBeenCalledWith([photoPath]);
  });
});

describe("action deleteDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supprime la livraison et sa photo", async () => {
    deleteSelect.mockResolvedValueOnce({ data: [{ photo_path: "2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg" }], error: null });
    const { deleteDelivery } = await import("@/app/(admin)/livraisons/nouvelle/actions");
    const form = new FormData();
    form.set("id", "0f8fad5b-d9cb-469f-a165-70867728950e");
    await deleteDelivery(form);
    expect(remove).toHaveBeenCalledWith(["2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg"]);
  });

  it("refuse un identifiant invalide", async () => {
    const { deleteDelivery } = await import("@/app/(admin)/livraisons/nouvelle/actions");
    const form = new FormData();
    form.set("id", "1 or 1=1");
    await expect(deleteDelivery(form)).rejects.toThrow();
    expect(deleteSelect).not.toHaveBeenCalled();
  });
});
