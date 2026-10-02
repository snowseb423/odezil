import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { MonthSwitcher } from "@/components/month-switcher";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { computeVariance, monthExpectedTotal } from "@/lib/calculations";
import { fetchDeliveriesOfMonth, fetchSoaStatements } from "@/lib/data/admin";
import { formatMonthFrCapitalized, formatOfMonthFr, monthKeyOf, todayIso } from "@/lib/dates";
import { TREATMENT_SHORT_LABELS } from "@/lib/labels";
import { centsToInputValue, formatRs, formatRsSigned } from "@/lib/money";
import { monthParam, previousMonth } from "@/lib/search-params";
import { deleteSoa } from "./actions";
import { SoaForm } from "./soa-form";

export const metadata: Metadata = { title: "Rapprochement SOA" };

export default async function SoaPage({ searchParams }: PageProps<"/soa">) {
  const { supabase } = await requireAdmin();
  const { mois, ok } = await searchParams;
  const currentMonth = monthKeyOf(todayIso());
  const month = monthParam(mois, currentMonth, previousMonth(currentMonth));

  const [deliveries, soas] = await Promise.all([fetchDeliveriesOfMonth(supabase, month), fetchSoaStatements(supabase)]);
  const expectedTotal = monthExpectedTotal(deliveries, month);
  const existing = soas.find((soa) => soa.month === month) ?? null;
  const currentVariance = existing ? computeVariance(existing.totalBilledCents, expectedTotal) : null;

  return (
    <main>
      <PageHeader title="Rapprochement SOA" subtitle="Comparez le relevé Odezil aux livraisons saisies." backHref="/" />
      <MonthSwitcher month={month} maxMonth={currentMonth} basePath="/soa" />

      {ok === "1" && existing && (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center font-medium text-emerald-800">
          SOA {formatOfMonthFr(month)} enregistré.
        </p>
      )}

      <p className="mb-4 text-sm text-slate-600">
        {deliveries.length === 0
          ? "Aucune livraison saisie ce mois-ci."
          : `${deliveries.length} livraison${deliveries.length > 1 ? "s" : ""} saisie${deliveries.length > 1 ? "s" : ""} ce mois-ci.`}
      </p>

      {existing && currentVariance !== existing.varianceCents && (
        <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
          Les livraisons du mois ont changé depuis l&apos;enregistrement : l&apos;écart enregistré ({formatRsSigned(existing.varianceCents)})
          ne correspond plus à l&apos;écart actuel ({formatRsSigned(currentVariance ?? 0)}). Validez à nouveau pour le mettre à jour.
        </p>
      )}

      <SoaForm
        key={`${month}-${existing?.updatedAt ?? "new"}`}
        month={month}
        expectedTotal={expectedTotal}
        initialTotal={existing ? centsToInputValue(existing.totalBilledCents) : ""}
        initialTreatment={existing && existing.varianceCents !== 0 ? existing.varianceTreatment : null}
        initialNote={existing?.note ?? ""}
      />

      {existing && (
        <form action={deleteSoa} className="mt-3">
          <input type="hidden" name="month" value={month} />
          <ConfirmSubmit
            label="Supprimer ce relevé"
            message={`Supprimer le SOA ${formatOfMonthFr(month)} ?`}
            className="btn btn-danger w-full"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
            Supprimer ce relevé
          </ConfirmSubmit>
        </form>
      )}

      {soas.length > 0 && (
        <section className="card mt-8">
          <h2 className="mb-2 text-lg font-semibold">Relevés enregistrés</h2>
          <ul className="divide-y divide-slate-100">
            {soas.map((soa) => (
              <li key={soa.id}>
                <Link href={`/soa?mois=${soa.month}`} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-medium">{formatMonthFrCapitalized(soa.month)}</span>
                    <span className="block text-sm text-slate-600">
                      {soa.varianceCents === 0
                        ? "Rapproché"
                        : `Écart ${formatRsSigned(soa.varianceCents)}, ${TREATMENT_SHORT_LABELS[soa.varianceTreatment]}`}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatRs(soa.totalBilledCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
