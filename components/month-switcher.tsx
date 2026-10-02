import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, formatMonthFrCapitalized } from "@/lib/dates";

type MonthSwitcherProps = {
  month: string;
  maxMonth: string;
  basePath: string;
};

/** Sélecteur de mois ‹ Septembre 2026 › (liens, sans JavaScript). */
export function MonthSwitcher({ month, maxMonth, basePath }: MonthSwitcherProps) {
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const linkClass = "flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-white active:bg-slate-50";

  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link href={`${basePath}?mois=${previous}`} className={linkClass} aria-label="Mois précédent">
        <ChevronLeft className="h-6 w-6" aria-hidden="true" />
      </Link>
      <p className="text-lg font-semibold">{formatMonthFrCapitalized(month)}</p>
      {next <= maxMonth ? (
        <Link href={`${basePath}?mois=${next}`} className={linkClass} aria-label="Mois suivant">
          <ChevronRight className="h-6 w-6" aria-hidden="true" />
        </Link>
      ) : (
        <span className="h-12 w-12" aria-hidden="true" />
      )}
    </div>
  );
}
