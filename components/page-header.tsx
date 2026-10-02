import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
};

export function PageHeader({ title, subtitle, backHref }: PageHeaderProps) {
  return (
    <header className="mb-5">
      {backHref && (
        <Link
          href={backHref}
          className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-sky-700"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          Retour
        </Link>
      )}
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
    </header>
  );
}
