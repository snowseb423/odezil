import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf :
     * - /p/...            page Cardinal par lien privé (aucune session Supabase)
     * - /auth/...         callback de connexion (gère lui-même la session)
     * - /_next/static, /_next/image, fichiers statiques, manifest, service worker
     */
    "/((?!p/|auth/|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|robots\\.txt|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
