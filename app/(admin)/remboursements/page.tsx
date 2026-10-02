import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { adjustmentsForB, balanceB } from "@/lib/calculations";
import { fetchLedger } from "@/lib/data/admin";
import { formatDateFr, todayIso } from "@/lib/dates";
import { HOUSEHOLD_B } from "@/lib/households";
import { formatRs } from "@/lib/money";
import { deleteRepayment } from "./actions";
import { RepaymentForm } from "./repayment-form";

export const metadata: Metadata = { title: "Remboursements" };

export default async function RepaymentsPage({ searchParams }: PageProps<"/remboursements">) {
  const { supabase } = await requireAdmin();
  const { ok } = await searchParams;
  const { deliveries, soas, repayments } = await fetchLedger(supabase);
  const balance = balanceB({ deliveries, adjustments: adjustmentsForB(soas), repayments });

  return (
    <main className="space-y-6">
      <PageHeader title="Remboursements" subtitle={`Sommes reçues du ${HOUSEHOLD_B}, partielles ou groupées.`} backHref="/" />

      {ok === "1" && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center font-medium text-emerald-800">
          Remboursement enregistré.
        </p>
      )}

      <div className="card flex items-baseline justify-between gap-3">
        <span className="text-slate-600">{balance >= 0 ? "Solde à régler" : "Crédit du Cardinal"}</span>
        <span className="text-2xl font-bold tabular-nums">{formatRs(Math.abs(balance))}</span>
      </div>

      <RepaymentForm today={todayIso()} />

      <section className="card">
        <h2 className="mb-1 text-lg font-semibold">Remboursements reçus</h2>
        {repayments.length === 0 ? (
          <p className="text-slate-600">Aucun remboursement enregistré.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {repayments.map((repayment) => (
              <li key={repayment.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold tabular-nums">{formatRs(repayment.amountCents)}</p>
                  <p className="text-sm text-slate-600">{formatDateFr(repayment.repaymentDate)}</p>
                  {repayment.note && <p className="text-sm text-slate-500 italic">{repayment.note}</p>}
                </div>
                <form action={deleteRepayment}>
                  <input type="hidden" name="id" value={repayment.id} />
                  <ConfirmSubmit
                    label="Supprimer le remboursement"
                    message={`Supprimer le remboursement de ${formatRs(repayment.amountCents)} du ${formatDateFr(repayment.repaymentDate)} ?`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 active:bg-red-50 active:text-red-700"
                  >
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
