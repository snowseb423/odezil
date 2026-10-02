import type { Metadata } from "next";
import { BottomNav } from "@/components/bottom-nav";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { requireAdmin } from "@/lib/auth";
import { pwaMetadata } from "@/lib/pwa-metadata";

export const metadata: Metadata = {
  ...pwaMetadata,
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  await requireAdmin();

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-md px-4 pt-6 pb-28">{children}</div>
      <BottomNav />
      <ServiceWorkerRegistration />
    </>
  );
}
