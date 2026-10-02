import type { Metadata } from "next";
import { LogOut, Trash2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { priceInEffect } from "@/lib/calculations";
import { fetchPriceSettings } from "@/lib/data/admin";
import { formatDateFr, todayIso } from "@/lib/dates";
import { HOUSEHOLD_B } from "@/lib/households";
import { formatRs } from "@/lib/money";
import { deletePrice, signOut } from "./actions";
import { PriceForm } from "./price-form";
import { ShareLinkPanel } from "./share-link-panel";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const { supabase, user } = await requireAdmin();

  const [{ data: activeLink, error }, prices] = await Promise.all([
    supabase.from("share_links").select("created_at").is("revoked_at", null).maybeSingle(),
    fetchPriceSettings(supabase),
  ]);
  if (error) throw new Error("Lecture du lien impossible");
  const today = todayIso();
  const currentPrice = priceInEffect(prices, today);

  return (
    <main className="space-y-6">
      <PageHeader title="Réglages" />

      <section className="card space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Prix de la bonbonne</h2>
          <p className="font-bold tabular-nums">{currentPrice === null ? "—" : formatRs(currentPrice)}</p>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {prices.map((price) => (
            <li key={price.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium tabular-nums">{formatRs(price.unitPriceCents)}</span>
                <span className="text-slate-600"> depuis le {formatDateFr(price.effectiveFrom)}</span>
              </span>
              {prices.length > 1 && (
                <form action={deletePrice}>
                  <input type="hidden" name="id" value={price.id} />
                  <ConfirmSubmit
                    label="Supprimer ce prix"
                    message={`Supprimer le prix de ${formatRs(price.unitPriceCents)} du ${formatDateFr(price.effectiveFrom)} ? Les livraisons déjà saisies ne changent pas.`}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 active:bg-red-50 active:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </ConfirmSubmit>
                </form>
              )}
            </li>
          ))}
        </ul>
        <PriceForm today={today} />
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Lien du {HOUSEHOLD_B}</h2>
        <ShareLinkPanel activeSince={activeLink ? formatDateFr(todayIso(new Date(activeLink.created_at))) : null} />
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Compte</h2>
        <p className="text-sm text-slate-600">Connecté : {user.email}</p>
        <form action={signOut}>
          <button type="submit" className="btn btn-secondary w-full">
            <LogOut className="h-5 w-5" aria-hidden="true" />
            Se déconnecter
          </button>
        </form>
      </section>
    </main>
  );
}
