import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Client Supabase lié à la session de l'utilisateur (cookies) : toutes les
 * requêtes passent par le RLS (is_admin()). À utiliser dans les Server
 * Components, Server Actions et Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component (cookies en lecture seule) :
          // le proxy rafraîchit la session à chaque requête.
        }
      },
    },
  });
}
