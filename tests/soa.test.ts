import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryRecord } from "@/lib/data/admin";
import { soaInputSchema } from "@/lib/soa-input";

describe("validation d'un SOA", () => {
  const schema = soaInputSchema("2026-10");

  it("convertit le total en centimes", () => {
    expect(schema.parse({ month: "2026-09", totalBilled: "2 880,50" })).toEqual({
      month: "2026-09",
      totalBilled: 288_050,
      treatment: null,
      note: null,
    });
  });

  it.each([
    [{ month: "2026-11", totalBilled: "100" }, "Le mois ne peut pas être dans le futur"],
    [{ month: "2026-13", totalBilled: "100" }, "Mois invalide"],
    [{ month: "2026-09", totalBilled: "-100" }, "Montant du SOA invalide (ex. 1 200,00)"],
    [{ month: "2026-09", totalBilled: "12,345" }, "Montant du SOA invalide (ex. 1 200,00)"],
    [{ month: "2026-09", totalBilled: "100", treatment: "ignorer" }, undefined],
  ])("refuse %o", (input, message) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (message) expect(result.error?.issues.map((issue) => issue.message)).toContain(message);
  });
});

// --- Action saveSoa --------------------------------------------------------

let monthDeliveries: DeliveryRecord[] = [];
const upsert = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ supabase: { from: () => ({ upsert }) } })),
}));
vi.mock("@/lib/data/admin", () => ({
  fetchDeliveriesOfMonth: vi.fn(async () => monthDeliveries),
}));
vi.mock("@/lib/dates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dates")>()),
  todayIso: () => "2026-10-02",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function delivery(deliveryDate: string, bottlesA: number, bottlesB: number): DeliveryRecord {
  return {
    id: crypto.randomUUID(),
    deliveryDate,
    bottlesA,
    bottlesB,
    unitPriceCentsApplied: 24_000,
    photoPath: null,
    note: null,
    createdAt: "",
  };
}

describe("action saveSoa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 12 bonbonnes en septembre = Rs 2 880,00 attendus.
    monthDeliveries = [delivery("2026-09-02", 3, 3), delivery("2026-09-16", 2, 4)];
  });

  async function save(input: Parameters<typeof import("@/app/(admin)/soa/actions").saveSoa>[0]) {
    const { saveSoa } = await import("@/app/(admin)/soa/actions");
    return saveSoa(input);
  }

  it("écart nul : enregistre sans exiger de traitement", async () => {
    await expect(save({ month: "2026-09", totalBilled: "2880" })).rejects.toThrow("REDIRECT:/soa?mois=2026-09&ok=1");
    expect(upsert).toHaveBeenCalledWith(
      { month: "2026-09-01", total_billed_cents: 288_000, variance_cents: 0, variance_treatment: "pending", note: null },
      { onConflict: "month" },
    );
  });

  it("écart non nul sans traitement : bloqué, écart renvoyé", async () => {
    const result = await save({ month: "2026-09", totalBilled: "3120" });
    expect(result).toMatchObject({ ok: false, varianceCents: 24_000 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("écart positif imputé au Cardinal : figé à l'enregistrement", async () => {
    await expect(save({ month: "2026-09", totalBilled: "3120", treatment: "impute_to_b" })).rejects.toThrow("REDIRECT");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ variance_cents: 24_000, variance_treatment: "impute_to_b" }),
      { onConflict: "month" },
    );
  });

  it("écart négatif mis en attente explicitement", async () => {
    await expect(save({ month: "2026-09", totalBilled: "2640", treatment: "pending" })).rejects.toThrow("REDIRECT");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ variance_cents: -24_000, variance_treatment: "pending" }),
      { onConflict: "month" },
    );
  });

  it("l'écart est recalculé côté serveur, jamais fourni par le client", async () => {
    await expect(
      save({ month: "2026-09", totalBilled: "2880", treatment: "split_50_50", varianceCents: 999 } as never),
    ).rejects.toThrow("REDIRECT");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ variance_cents: 0, variance_treatment: "pending" }), {
      onConflict: "month",
    });
  });
});
