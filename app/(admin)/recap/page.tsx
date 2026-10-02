import type { Metadata } from "next";
import { CopyButton } from "@/components/copy-button";
import { MonthSwitcher } from "@/components/month-switcher";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { fetchLedger } from "@/lib/data/admin";
import { monthKeyOf, todayIso } from "@/lib/dates";
import { formatRs, formatRsSigned } from "@/lib/money";
import { buildRecap } from "@/lib/recap";
import { monthParam, previousMonth } from "@/lib/search-params";

export const metadata: Metadata = { title: "Message récapitulatif" };

export default async function RecapPage({ searchParams }: PageProps<"/recap">) {
  const { supabase } = await requireAdmin();
  const { mois } = await searchParams;
  const currentMonth = monthKeyOf(todayIso());
  const month = monthParam(mois, currentMonth, previousMonth(currentMonth));

  const ledger = await fetchLedger(supabase);
  const recap = buildRecap(month, ledger);
  const soa = ledger.soas.find((s) => s.month === month);

  return (
    <main className="space-y-5">
      <PageHeader title="Message récapitulatif" subtitle="À envoyer au Cardinal par WhatsApp." backHref="/" />
      <MonthSwitcher month={month} maxMonth={currentMonth} basePath="/recap" />

      {soa && soa.varianceCents !== 0 && soa.varianceTreatment === "pending" && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
          L&apos;écart SOA de ce mois ({formatRsSigned(soa.varianceCents)}) est en attente : il n&apos;est pas inclus.
        </p>
      )}

      <div className="card">
        <p className="text-lg leading-relaxed whitespace-pre-wrap" data-testid="recap-text">
          {recap.text}
        </p>
      </div>

      <CopyButton text={recap.text} label="Copier le message" />

      <dl className="card space-y-2 text-sm tabular-nums">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">Bonbonnes du mois</dt>
          <dd className="font-medium">{recap.bottlesB}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">Montant des livraisons</dt>
          <dd className="font-medium">{formatRs(recap.deliveriesAmountCents)}</dd>
        </div>
        {recap.adjustmentCents !== 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600">Ajustement</dt>
            <dd className="font-medium">{formatRsSigned(recap.adjustmentCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">{recap.previousBalanceCents < 0 ? "Crédit antérieur" : "Solde antérieur"}</dt>
          <dd className="font-medium">{formatRs(Math.abs(recap.previousBalanceCents))}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-slate-100 pt-2">
          <dt className="font-semibold">{recap.totalDueCents < 0 ? "Crédit du Cardinal" : "Total à régler"}</dt>
          <dd className="font-bold">{formatRs(Math.abs(recap.totalDueCents))}</dd>
        </div>
      </dl>
    </main>
  );
}
