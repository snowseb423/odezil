import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedAdmin } from "@/lib/auth-rules";
import { adminEmail, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Chemins accessibles sans session admin (le proxy y rafraîchit seulement la session). */
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const;

/** Redirection qui conserve les cookies et en-têtes anti-cache posés par Supabase. */
function redirectKeepingSession(request: NextRequest, from: NextResponse, pathname: string, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  for (const header of CACHE_HEADERS) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

/**
 * Rafraîchit la session Supabase puis protège les routes admin :
 * - aucune session → /login ;
 * - session d'un compte non autorisé → déconnexion + /login?error=unauthorized.
 * Ce n'est qu'une première barrière : layout admin et Server Actions
 * appellent aussi requireAdmin(), et le RLS filtre avec is_admin().
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Ne rien exécuter entre createServerClient et getUser() (rafraîchissement du jeton).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return response;
  }

  if (!user) {
    return redirectKeepingSession(request, response, "/login");
  }

  const { data: claims } = await supabase.auth.getClaims();
  if (!isAuthorizedAdmin(user, adminEmail(), claims?.claims.amr)) {
    await supabase.auth.signOut();
    return redirectKeepingSession(request, response, "/login", "?error=unauthorized");
  }

  return response;
}
