import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { monthlySummaries } from "@/lib/calculations";
import { deliveriesCsv, monthsCsv } from "@/lib/csv";
import { fetchDeliveries, fetchSoaStatements } from "@/lib/data/admin";
import { todayIso } from "@/lib/dates";

/** Export CSV : `?type=livraisons` (une ligne par livraison) ou `?type=mois`. */
export async function GET(request: NextRequest) {
  const { supabase } = await requireAdmin();
  const type = request.nextUrl.searchParams.get("type") === "mois" ? "mois" : "livraisons";

  const deliveries = await fetchDeliveries(supabase);
  const csv =
    type === "mois" ? monthsCsv(monthlySummaries(deliveries, await fetchSoaStatements(supabase))) : deliveriesCsv(deliveries);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="eaupartagee-${type}-${todayIso()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
