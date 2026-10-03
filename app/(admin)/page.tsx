import Link from "next/link";
import { FileCheck2, HandCoins, MessageSquareText, Plus } from "lucide-react";
import { DeliveryList } from "@/components/delivery-list";
import { requireAdmin } from "@/lib/auth";
import { adjustmentsForB, balanceB } from "@/lib/calculations";
import { fetchLedger } from "@/lib/data/admin";
import { HOUSEHOLD_B } from "@/lib/households";
import { noticeFor } from "@/lib/notices";
import { formatRs } from "@/lib/money";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { supabase } = await requireAdmin();
  const { ok } = await searchParams;
  const notice = noticeFor(ok);

  // Diagnostic : la base (RLS) reconnaît-elle ce compte comme admin ? Sinon,
  // l'application s'ouvre mais toutes les données restent vides.
  const { data: dbAdmin } = await supabase.rpc("is_admin");

  const { deliveries, soas, repayments } = await fetchLedger(supabase);
  const balance = balanceB({ deliveries, adjustments: adjustmentsForB(soas), repayments });
  const pendingVariances = soas.filter((soa) => soa.varianceCents !== 0 && soa.varianceTreatment === "pending").length;

  return (
    <main className="space-y-6">
      {notice && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center font-medium text-emerald-800">
          {notice}
        </p>
      )}

      {dbAdmin !== true && (
        <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">La base de données ne reconnaît pas ce compte comme administrateur.</p>
          <p className="mt-1">
            Les données restent invisibles et les saisies sont refusées. Vérifiez que votre adresse figure, en minuscules,
            dans la table <code>admin_allowlist</code> et que votre compte est confirmé : lancez <code>npm run seed:admin</code>{" "}
            (README, § 6).
          </p>
        </section>
      )}

      <section className="rounded-3xl bg-sky-700 p-6 text-white shadow-lg">
        <p className="text-sky-100">
          {balance > 0 ? `Le ${HOUSEHOLD_B} vous doit` : balance < 0 ? `Crédit du ${HOUSEHOLD_B}` : `${HOUSEHOLD_B} : rien à régler`}
        </p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatRs(Math.abs(balance))}</p>
      </section>

      <Link href="/livraisons/nouvelle" className="btn btn-primary w-full text-lg">
        <Plus className="h-6 w-6" aria-hidden="true" />
        Nouvelle livraison
      </Link>

      {pendingVariances > 0 && (
        <Link
          href="/historique"
          className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
        >
          {pendingVariances === 1
            ? "1 écart SOA est en attente de traitement."
            : `${pendingVariances} écarts SOA sont en attente de traitement.`}
        </Link>
      )}

      <nav aria-label="Actions" className="grid grid-cols-3 gap-3">
        <Link href="/soa" className="card flex flex-col items-center gap-2 text-center text-sm font-medium">
          <FileCheck2 className="h-6 w-6 text-sky-700" aria-hidden="true" />
          Rapprocher un SOA
        </Link>
        <Link href="/recap" className="card flex flex-col items-center gap-2 text-center text-sm font-medium">
          <MessageSquareText className="h-6 w-6 text-sky-700" aria-hidden="true" />
          Message récap
        </Link>
        <Link href="/remboursements" className="card flex flex-col items-center gap-2 text-center text-sm font-medium">
          <HandCoins className="h-6 w-6 text-sky-700" aria-hidden="true" />
          Rembour&shy;sement
        </Link>
      </nav>

      <section className="card">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Dernières livraisons</h2>
          <Link href="/historique" className="text-sm font-medium text-sky-700">
            Tout voir
          </Link>
        </div>
        <DeliveryList deliveries={deliveries.slice(0, 5)} />
      </section>
    </main>
  );
}
