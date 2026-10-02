"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { computeVariance, monthExpectedTotal, resolveVarianceTreatment } from "@/lib/calculations";
import { fetchDeliveriesOfMonth } from "@/lib/data/admin";
import { isMonthKey, monthKeyOf, monthStartDate, todayIso } from "@/lib/dates";
import { soaInputSchema, type SoaInput } from "@/lib/soa-input";

export type SoaActionResult = { ok: false; error: string; varianceCents?: number };

/**
 * Enregistre (ou remplace) le SOA d'un mois. L'écart est recalculé ici à partir
 * des livraisons en base, puis figé. Un écart non nul exige un traitement
 * explicite (« En attente » compris).
 */
export async function saveSoa(input: SoaInput): Promise<SoaActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = soaInputSchema(monthKeyOf(todayIso())).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }
  const { month, totalBilled, treatment, note } = parsed.data;

  let deliveries;
  try {
    deliveries = await fetchDeliveriesOfMonth(supabase, month);
  } catch {
    return { ok: false, error: "Lecture des livraisons impossible. Réessayez." };
  }
  const varianceCents = computeVariance(totalBilled, monthExpectedTotal(deliveries, month));

  const resolved = resolveVarianceTreatment(varianceCents, treatment);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, varianceCents };
  }

  const { error } = await supabase.from("soa_statements").upsert(
    {
      month: monthStartDate(month),
      total_billed_cents: totalBilled,
      variance_cents: varianceCents,
      variance_treatment: resolved.treatment,
      note,
    },
    { onConflict: "month" },
  );
  if (error) {
    return { ok: false, error: "Enregistrement impossible. Réessayez." };
  }

  revalidatePath("/", "layout");
  redirect(`/soa?mois=${month}&ok=1`);
}

/** Supprime le SOA d'un mois (ex. saisi sur le mauvais mois). */
export async function deleteSoa(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const month = String(formData.get("month") ?? "");
  if (!isMonthKey(month)) {
    throw new Error("Mois invalide");
  }
  const { error } = await supabase.from("soa_statements").delete().eq("month", monthStartDate(month));
  if (error) {
    throw new Error("Suppression impossible");
  }
  revalidatePath("/", "layout");
  redirect(`/soa?mois=${month}`);
}
