"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HandCoins, History, House, Plus, Settings } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Accueil", icon: House },
  { href: "/historique", label: "Historique", icon: History },
  { href: "/livraisons/nouvelle", label: "Livraison", icon: Plus, primary: true },
  { href: "/remboursements", label: "Rembours.", icon: HandCoins },
  { href: "/parametres", label: "Réglages", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  active ? "text-sky-700" : "text-slate-500"
                }`}
              >
                {"primary" in item ? (
                  <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-sky-700 text-white shadow-lg">
                    <Icon className="h-7 w-7" aria-hidden="true" />
                  </span>
                ) : (
                  <Icon className="h-6 w-6" aria-hidden="true" />
                )}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
