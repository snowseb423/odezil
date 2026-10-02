import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Delivery, PriceSetting, Repayment, SoaStatement } from "@/lib/calculations";
import type { Database } from "@/lib/database.types";
import { addMonths, monthStartDate } from "@/lib/dates";

/**
 * Lectures admin. Toujours avec le client lié à la session (requireAdmin()),
 * donc filtrées par le RLS is_admin(). Les colonnes snake_case de Postgres
 * deviennent des objets camelCase utilisés par lib/calculations.ts.
 */
export type AdminClient = SupabaseClient<Database>;

export type PriceSettingRecord = PriceSetting & { id: string };

export type DeliveryRecord = Delivery & {
  id: string;
  photoPath: string | null;
  note: string | null;
  createdAt: string;
};

export type SoaRecord = SoaStatement & {
  id: string;
  note: string | null;
  updatedAt: string;
};

export type RepaymentRecord = Repayment & {
  id: string;
  note: string | null;
};

function fail(what: string, message: string): never {
  throw new Error(`Lecture impossible (${what}) : ${message}`);
}

export async function fetchPriceSettings(supabase: AdminClient): Promise<PriceSettingRecord[]> {
  const { data, error } = await supabase
    .from("price_settings")
    .select("id, unit_price_cents, effective_from")
    .order("effective_from", { ascending: false });
  if (error) fail("prix", error.message);
  return data.map((row) => ({
    id: row.id,
    unitPriceCents: row.unit_price_cents,
    effectiveFrom: row.effective_from,
  }));
}

const DELIVERY_COLUMNS = "id, delivery_date, bottles_a, bottles_b, unit_price_cents_applied, photo_path, note, created_at";

type DeliveryRow = Database["public"]["Tables"]["deliveries"]["Row"];

function toDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    deliveryDate: row.delivery_date,
    bottlesA: row.bottles_a,
    bottlesB: row.bottles_b,
    unitPriceCentsApplied: row.unit_price_cents_applied,
    photoPath: row.photo_path,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Livraisons, de la plus récente à la plus ancienne. */
export async function fetchDeliveries(supabase: AdminClient, options: { limit?: number } = {}): Promise<DeliveryRecord[]> {
  let query = supabase
    .from("deliveries")
    .select(DELIVERY_COLUMNS)
    .order("delivery_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) fail("livraisons", error.message);
  return data.map(toDelivery);
}

export async function fetchSoaStatements(supabase: AdminClient): Promise<SoaRecord[]> {
  const { data, error } = await supabase
    .from("soa_statements")
    .select("id, month, total_billed_cents, variance_cents, variance_treatment, note, updated_at")
    .order("month", { ascending: false });
  if (error) fail("relevés SOA", error.message);
  return data.map((row) => ({
    id: row.id,
    month: row.month.slice(0, 7),
    totalBilledCents: row.total_billed_cents,
    varianceCents: row.variance_cents,
    varianceTreatment: row.variance_treatment,
    note: row.note,
    updatedAt: row.updated_at,
  }));
}

export async function fetchRepayments(supabase: AdminClient): Promise<RepaymentRecord[]> {
  const { data, error } = await supabase
    .from("repayments")
    .select("id, repayment_date, amount_cents, note")
    .order("repayment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) fail("remboursements", error.message);
  return data.map((row) => ({
    id: row.id,
    repaymentDate: row.repayment_date,
    amountCents: row.amount_cents,
    note: row.note,
  }));
}

/** Livraisons d'un mois (`YYYY-MM`). */
export async function fetchDeliveriesOfMonth(supabase: AdminClient, month: string): Promise<DeliveryRecord[]> {
  const { data, error } = await supabase
    .from("deliveries")
    .select(DELIVERY_COLUMNS)
    .gte("delivery_date", monthStartDate(month))
    .lt("delivery_date", monthStartDate(addMonths(month, 1)))
    .order("delivery_date", { ascending: true });
  if (error) fail("livraisons du mois", error.message);
  return data.map(toDelivery);
}

/** Toutes les données nécessaires au solde et aux résumés mensuels. */
export async function fetchLedger(supabase: AdminClient) {
  const [deliveries, soas, repayments] = await Promise.all([
    fetchDeliveries(supabase),
    fetchSoaStatements(supabase),
    fetchRepayments(supabase),
  ]);
  return { deliveries, soas, repayments };
}
