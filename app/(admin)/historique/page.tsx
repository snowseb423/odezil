import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileCheck2, MessageSquareText, TriangleAlert } from "lucide-react";
import { DeliveryList } from "@/components/delivery-list";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { monthlySummaries, type MonthStatus } from "@/lib/calculations";
import { fetchDeliveries, fetchSoaStatements } from "@/lib/data/admin";
import { formatMonthFrCapitalized } from "@/lib/dates";
import { HOUSEHOLD_A, HOUSEHOLD_B } from "@/lib/households";
import { MONTH_STATUS_LABELS, TREATMENT_SHORT_LABELS } from "@/lib/labels";
import { formatRs, formatRsSigned } from "@/lib/money";

export const metadata: Metadata = { title: "Historique" };

const STATUS_STYLES: Record<MonthStatus, string> = {
  no_soa: "bg-slate-100 text-slate-700",
  reconciled: "bg-emerald-100 text-emerald-800",
  variance_pending: "bg-amber-100 text-amber-900",
  variance_treated: "bg-sky-100 text-sky-800",
};

export default async function HistoryPage() {
  const { supabase } = await requireAdmin();
  const [deliveries, soas] = await Promise.all([fetchDeliveries(supabase), fetchSoaStatements(supabase)]);
  const summaries = monthlySummaries(deliveries, soas);

  return (
    <main className="space-y-5">
      <PageHeader title="Historique" subtitle="Livraisons et rapprochements, mois par mois." />

      <div className="grid grid-cols-2 gap-3">
        <a href="/historique/export?type=livraisons" className="btn btn-secondary text-sm" download>
          <Download className="h-5 w-5" aria-hidden="true" />
          CSV livraisons
        </a>
        <a href="/historique/export?type=mois" className="btn btn-secondary text-sm" download>
          <Download className="h-5 w-5" aria-hidden="true" />
          CSV mensuel
        </a>
      </div>

      {summaries.length === 0 && <p className="text-slate-600">Aucune donnée pour le moment.</p>}

      {summaries.map((summary) => (
        <section key={summary.month} className="card space-y-3" aria-label={formatMonthFrCapitalized(summary.month)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{formatMonthFrCapitalized(summary.month)}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[summary.status]}`}>
              {MONTH_STATUS_LABELS[summary.status]}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-slate-600">{HOUSEHOLD_A}</dt>
            <dd className="text-right">
              {summary.bottlesA} · {formatRs(summary.totalA)}
            </dd>
            <dt className="text-slate-600">{HOUSEHOLD_B}</dt>
            <dd className="text-right">
              {summary.bottlesB} · {formatRs(summary.totalB)}
            </dd>
            <dt className="text-slate-600">Total attendu</dt>
            <dd className="text-right font-medium">{formatRs(summary.expectedTotal)}</dd>
            <dt className="text-slate-600">Total SOA</dt>
            <dd className="text-right font-medium">{summary.soa ? formatRs(summary.soa.totalBilledCents) : "—"}</dd>
            {summary.soa && (
              <>
                <dt className="text-slate-600">Écart</dt>
                <dd
                  className={`text-right font-semibold ${summary.soa.varianceCents === 0 ? "text-emerald-700" : "text-amber-700"}`}
                >
                  {formatRsSigned(summary.soa.varianceCents)}
                  {summary.soa.varianceCents !== 0 && (
                    <span className="block text-xs font-normal text-slate-600">
                      {TREATMENT_SHORT_LABELS[summary.soa.varianceTreatment]}
                    </span>
                  )}
                </dd>
              </>
            )}
            <dt className="font-medium">Dû par le {HOUSEHOLD_B}</dt>
            <dd className="text-right font-bold">{formatRs(summary.amountB)}</dd>
          </dl>

          {summary.soa?.stale && (
            <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
              Les livraisons ont changé depuis le rapprochement (écart actuel {formatRsSigned(summary.soa.currentVarianceCents)}).
              Validez à nouveau le SOA.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link href={`/soa?mois=${summary.month}`} className="btn btn-secondary min-h-12 text-sm">
              <FileCheck2 className="h-5 w-5" aria-hidden="true" />
              SOA
            </Link>
            <Link href={`/recap?mois=${summary.month}`} className="btn btn-secondary min-h-12 text-sm">
              <MessageSquareText className="h-5 w-5" aria-hidden="true" />
              Récap
            </Link>
          </div>

          {summary.deliveries.length > 0 && (
            <details>
              <summary className="cursor-pointer py-2 text-sm font-medium text-sky-700">
                {summary.deliveries.length} livraison{summary.deliveries.length > 1 ? "s" : ""}
              </summary>
              <DeliveryList deliveries={summary.deliveries} allowDelete />
            </details>
          )}
        </section>
      ))}
    </main>
  );
}
