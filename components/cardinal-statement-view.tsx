import { Droplets } from "lucide-react";
import type { CardinalStatement } from "@/lib/cardinal-statement";
import { formatDateFr, formatMonthFrCapitalized } from "@/lib/dates";
import { HOUSEHOLD_B } from "@/lib/households";
import { formatRs, formatRsSigned } from "@/lib/money";

/**
 * Relevé en lecture seule du foyer Cardinal (Server Component, aucun JS client).
 * Ne reçoit que des données du Cardinal.
 */
export function CardinalStatementView({ statement }: { statement: CardinalStatement }) {
  const { balanceCents, months, repayments, totalRepaidCents } = statement;

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-8">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-700 text-white">
          <Droplets className="h-7 w-7" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Eau — foyer {HOUSEHOLD_B}</h1>
          <p className="text-sm text-slate-600">Relevé des bonbonnes Odezil</p>
        </div>
      </header>

      <section className="rounded-3xl bg-sky-700 p-6 text-white shadow-lg" aria-label="Solde">
        <p className="text-sky-100">{balanceCents >= 0 ? "Solde à régler" : "Crédit en votre faveur"}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatRs(Math.abs(balanceCents))}</p>
      </section>

      {months.length === 0 && <p className="text-slate-600">Aucune livraison pour le moment.</p>}

      {months.map((month) => (
        <section key={month.month} className="card" aria-label={formatMonthFrCapitalized(month.month)}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{formatMonthFrCapitalized(month.month)}</h2>
            <p className="font-bold tabular-nums">{formatRs(month.totalCents)}</p>
          </div>
          <ul className="divide-y divide-slate-100 text-sm tabular-nums">
            {month.deliveries.map((delivery, index) => (
              <li key={`${delivery.date}-${index}`} className="flex justify-between gap-3 py-2">
                <span>
                  {formatDateFr(delivery.date)} · {delivery.bottles} bonbonne{delivery.bottles > 1 ? "s" : ""} ×{" "}
                  {formatRs(delivery.unitPriceCents)}
                </span>
                <span className="font-medium">{formatRs(delivery.amountCents)}</span>
              </li>
            ))}
            {month.adjustmentCents !== 0 && (
              <li className="flex justify-between gap-3 py-2">
                <span>Ajustement (relevé Odezil)</span>
                <span className="font-medium">{formatRsSigned(month.adjustmentCents)}</span>
              </li>
            )}
          </ul>
        </section>
      ))}

      <section className="card" aria-label="Remboursements">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Remboursements reçus</h2>
          <p className="font-bold tabular-nums">{formatRs(totalRepaidCents)}</p>
        </div>
        {repayments.length === 0 ? (
          <p className="text-sm text-slate-600">Aucun remboursement enregistré.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm tabular-nums">
            {repayments.map((repayment, index) => (
              <li key={`${repayment.date}-${index}`} className="flex justify-between gap-3 py-2">
                <span>{formatDateFr(repayment.date)}</span>
                <span className="font-medium">{formatRs(repayment.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-slate-500">Page en lecture seule, mise à jour à chaque visite.</p>
    </main>
  );
}
