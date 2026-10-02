import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

/**
 * Client service_role : contourne le RLS. Réservé à la page Cardinal
 * (/p/[token]), qui n'appelle que la RPC share_snapshot. Ne jamais l'utiliser
 * pour l'admin, ni l'importer dans un composant client.
 */
export function createServiceClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
