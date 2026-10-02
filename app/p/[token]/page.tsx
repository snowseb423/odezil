import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardinalStatementView } from "@/components/cardinal-statement-view";
import { buildCardinalStatement } from "@/lib/cardinal-statement";
import { getCardinalView } from "@/lib/data/cardinal";

// Toujours rendue à la demande, jamais mise en cache (en-têtes dans next.config.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relevé eau",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function CardinalPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const view = await getCardinalView(token);
  if (!view) {
    notFound();
  }
  return <CardinalStatementView statement={buildCardinalStatement(view)} />;
}
