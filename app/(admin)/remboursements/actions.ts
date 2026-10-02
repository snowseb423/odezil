"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { todayIso } from "@/lib/dates";
import { repaymentInputSchema } from "@/lib/repayment-input";

export type RepaymentFormState = {
  error: string | null;
  /** Saisie renvoyée en cas d'erreur, pour ne pas vider le formulaire. */
  values?: { repaymentDate: string; amount: string; note: string };
};

/** Enregistre un remboursement reçu du Cardinal (hors app). */
export async function createRepayment(_previous: RepaymentFormState, formData: FormData): Promise<RepaymentFormState> {
  const { supabase } = await requireAdmin();

  const values = {
    repaymentDate: String(formData.get("repaymentDate") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  const parsed = repaymentInputSchema(todayIso()).safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide", values };
  }

  const { error } = await supabase.from("repayments").insert({
    repayment_date: parsed.data.repaymentDate,
    amount_cents: parsed.data.amount,
    note: parsed.data.note,
  });
  if (error) {
    return { error: "Enregistrement impossible. Réessayez.", values };
  }

  revalidatePath("/", "layout");
  redirect("/remboursements?ok=1");
}

/** Supprime un remboursement saisi par erreur. */
export async function deleteRepayment(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const { error } = await supabase.from("repayments").delete().eq("id", id);
  if (error) {
    throw new Error("Suppression impossible");
  }
  revalidatePath("/", "layout");
  redirect("/remboursements");
}
