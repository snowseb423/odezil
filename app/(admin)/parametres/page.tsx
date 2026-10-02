import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { formatDateFr, todayIso } from "@/lib/dates";
import { HOUSEHOLD_B } from "@/lib/households";
import { signOut } from "./actions";
import { ShareLinkPanel } from "./share-link-panel";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const { supabase, user } = await requireAdmin();

  const { data: activeLink, error } = await supabase
    .from("share_links")
    .select("created_at")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("Lecture du lien impossible");

  return (
    <main className="space-y-6">
      <PageHeader title="Réglages" />

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
