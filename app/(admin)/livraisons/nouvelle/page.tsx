import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { fetchDeliveries, fetchPriceSettings } from "@/lib/data/admin";
import { todayIso } from "@/lib/dates";
import { DeliveryForm } from "./delivery-form";

export const metadata: Metadata = { title: "Nouvelle livraison" };

export default async function NewDeliveryPage() {
  const { supabase } = await requireAdmin();
  const [prices, [lastDelivery]] = await Promise.all([
    fetchPriceSettings(supabase),
    fetchDeliveries(supabase, { limit: 1 }),
  ]);

  return (
    <main>
      <PageHeader title="Nouvelle livraison" subtitle="Recopiez le bon du livreur." backHref="/" />
      <DeliveryForm
        prices={prices.map(({ unitPriceCents, effectiveFrom }) => ({ unitPriceCents, effectiveFrom }))}
        today={todayIso()}
        defaultBottlesA={lastDelivery?.bottlesA ?? 0}
        defaultBottlesB={lastDelivery?.bottlesB ?? 0}
      />
    </main>
  );
}
