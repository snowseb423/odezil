import { beforeEach, describe, expect, it, vi } from "vitest";
import { repaymentInputSchema } from "@/lib/repayment-input";

describe("validation d'un remboursement", () => {
  const schema = repaymentInputSchema("2026-10-02");

  it("accepte un remboursement partiel en centimes", () => {
    expect(schema.parse({ repaymentDate: "2026-10-01", amount: "333,33", note: "" })).toEqual({
      repaymentDate: "2026-10-01",
      amount: 33_333,
      note: null,
    });
  });

  it.each([
    [{ repaymentDate: "2026-10-01", amount: "0" }, "Montant invalide (ex. 1 200,00)"],
    [{ repaymentDate: "2026-10-01", amount: "-50" }, "Montant invalide (ex. 1 200,00)"],
    [{ repaymentDate: "2026-10-01", amount: "abc" }, "Montant invalide (ex. 1 200,00)"],
    [{ repaymentDate: "2026-10-03", amount: "50" }, "La date ne peut pas être dans le futur"],
    [{ repaymentDate: "2026-02-31", amount: "50" }, "Date invalide"],
  ])("refuse %o", (input, message) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message);
  });
});

const insert = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ supabase: { from: () => ({ insert }) } })),
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

describe("action createRepayment", () => {
  beforeEach(() => vi.clearAllMocks());

  function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  it("vérifie l'admin et enregistre le montant en centimes", async () => {
    const { createRepayment } = await import("@/app/(admin)/remboursements/actions");
    const { requireAdmin } = await import("@/lib/auth");
    await expect(
      createRepayment({ error: null }, form({ repaymentDate: "2026-10-01", amount: "1 500", note: "juillet + août" })),
    ).rejects.toThrow("REDIRECT:/remboursements?ok=1");
    expect(requireAdmin).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({ repayment_date: "2026-10-01", amount_cents: 150_000, note: "juillet + août" });
  });

  it("renvoie l'erreur de validation sans écrire", async () => {
    const { createRepayment } = await import("@/app/(admin)/remboursements/actions");
    const state = await createRepayment({ error: null }, form({ repaymentDate: "2026-10-01", amount: "0" }));
    expect(state.error).toBe("Montant invalide (ex. 1 200,00)");
    // La saisie est renvoyée pour ne pas vider le formulaire.
    expect(state.values).toEqual({ repaymentDate: "2026-10-01", amount: "0", note: "" });
    expect(insert).not.toHaveBeenCalled();
  });
});
