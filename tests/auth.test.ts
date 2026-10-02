import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedAdmin, isLoginError } from "@/lib/auth-rules";

// Isolation (b), côté application : un compte Google quelconque obtient une
// session Supabase valide, mais l'application le déconnecte immédiatement et
// ne lui donne accès à aucune route admin. (Côté base : tests/db/rls.test.ts.)

const ADMIN_EMAIL = "admin@example.com";
const CONFIRMED = "2026-01-01T00:00:00Z";

type FakeUser = { email: string | null; email_confirmed_at: string | null } | null;

function fakeSupabase(
  user: FakeUser,
  options: { exchangeError?: boolean; amr?: unknown } = {},
) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: options.exchangeError ? new Error("bad code") : null })),
      verifyOtp: vi.fn(async () => ({ error: options.exchangeError ? new Error("bad token") : null })),
      getUser: vi.fn(async () => ({ data: { user } })),
      getClaims: vi.fn(async () => ({
        data: user ? { claims: { email: user.email, amr: options.amr ?? [{ method: "oauth", timestamp: 1 }] } } : null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      signInWithOtp: vi.fn(async () => ({ error: null })),
    },
  };
}

let currentClient: ReturnType<typeof fakeSupabase>;
const statelessSignInWithOtp = vi.fn<(args: unknown) => Promise<{ error: null }>>(async () => ({ error: null }));
const afterTasks: Promise<unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentClient),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { signInWithOtp: statelessSignInWithOtp } })),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => {
    afterTasks.push(task());
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => currentClient),
}));

vi.mock("@/lib/request-origin", () => ({
  requestOrigin: vi.fn(async () => "https://eau.example.app"),
}));

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAIL", ADMIN_EMAIL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

describe("isAuthorizedAdmin", () => {
  it("accepte l'adresse admin confirmée, sans tenir compte de la casse ni des espaces", () => {
    expect(isAuthorizedAdmin({ email: "admin@example.com", email_confirmed_at: CONFIRMED }, ADMIN_EMAIL)).toBe(true);
    expect(isAuthorizedAdmin({ email: " Admin@Example.COM ", email_confirmed_at: CONFIRMED }, "ADMIN@example.com")).toBe(
      true,
    );
  });

  it("refuse tout autre compte Google", () => {
    expect(isAuthorizedAdmin({ email: "intrus@gmail.com", email_confirmed_at: CONFIRMED }, ADMIN_EMAIL)).toBe(false);
    expect(isAuthorizedAdmin({ email: "admin@example.com.evil.io", email_confirmed_at: CONFIRMED }, ADMIN_EMAIL)).toBe(
      false,
    );
  });

  it("refuse une adresse non confirmée", () => {
    expect(isAuthorizedAdmin({ email: ADMIN_EMAIL, email_confirmed_at: null }, ADMIN_EMAIL)).toBe(false);
    expect(isAuthorizedAdmin({ email: ADMIN_EMAIL }, ADMIN_EMAIL)).toBe(false);
  });

  it("refuse l'absence d'utilisateur ou d'email", () => {
    expect(isAuthorizedAdmin(null, ADMIN_EMAIL)).toBe(false);
    expect(isAuthorizedAdmin(undefined, ADMIN_EMAIL)).toBe(false);
    expect(isAuthorizedAdmin({ email: null, email_confirmed_at: CONFIRMED }, ADMIN_EMAIL)).toBe(false);
  });

  it("refuse une session ouverte par mot de passe (compte pré-créé par un tiers)", () => {
    const admin = { email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED };
    expect(isAuthorizedAdmin(admin, ADMIN_EMAIL, [{ method: "password", timestamp: 1 }])).toBe(false);
    expect(isAuthorizedAdmin(admin, ADMIN_EMAIL, ["oauth", "password"])).toBe(false);
    expect(isAuthorizedAdmin(admin, ADMIN_EMAIL, [{ method: "anonymous", timestamp: 1 }])).toBe(false);
    expect(isAuthorizedAdmin(admin, ADMIN_EMAIL, [{ method: "oauth", timestamp: 1 }])).toBe(true);
    expect(isAuthorizedAdmin(admin, ADMIN_EMAIL, [{ method: "otp", timestamp: 1 }])).toBe(true);
    expect(isAuthorizedAdmin(admin, ADMIN_EMAIL, undefined)).toBe(true);
  });

  it("refuse tout le monde si ADMIN_EMAIL est vide", () => {
    expect(isAuthorizedAdmin({ email: "", email_confirmed_at: CONFIRMED }, "")).toBe(false);
    expect(isAuthorizedAdmin({ email: " ", email_confirmed_at: CONFIRMED }, " ")).toBe(false);
  });

  it("codes d'erreur de connexion connus uniquement", () => {
    expect(isLoginError("unauthorized")).toBe(true);
    expect(isLoginError("auth")).toBe(true);
    expect(isLoginError("toString")).toBe(false);
    expect(isLoginError(undefined)).toBe(false);
  });
});

describe("GET /auth/callback", () => {
  async function callback(query: string) {
    const { GET } = await import("@/app/auth/callback/route");
    return GET(new NextRequest(`https://eau.example.app/auth/callback${query}`));
  }

  it("admin via Google : session conservée, redirection vers l'accueil", async () => {
    currentClient = fakeSupabase({ email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED });
    const response = await callback("?code=abc");
    expect(currentClient.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(currentClient.auth.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://eau.example.app/");
  });

  it("compte Google non autorisé : déconnexion immédiate et « Accès non autorisé »", async () => {
    currentClient = fakeSupabase({ email: "intrus@gmail.com", email_confirmed_at: CONFIRMED });
    const response = await callback("?code=abc");
    expect(currentClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
  });

  it("email admin non confirmé : refusé", async () => {
    currentClient = fakeSupabase({ email: ADMIN_EMAIL, email_confirmed_at: null });
    const response = await callback("?code=abc");
    expect(currentClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
  });

  it("lien magique (token_hash) de l'admin : accepté", async () => {
    currentClient = fakeSupabase({ email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED });
    const response = await callback("?token_hash=th&type=email");
    expect(currentClient.auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "th" });
    expect(response.headers.get("location")).toBe("https://eau.example.app/");
  });

  it("code invalide ou absent : erreur de connexion, sans session", async () => {
    currentClient = fakeSupabase(null, { exchangeError: true });
    expect((await callback("?code=bad")).headers.get("location")).toBe("https://eau.example.app/login?error=auth");
    expect((await callback("")).headers.get("location")).toBe("https://eau.example.app/login?error=auth");
    expect((await callback("?token_hash=x&type=recovery")).headers.get("location")).toBe(
      "https://eau.example.app/login?error=auth",
    );
  });

  it("session de l'admin ouverte par mot de passe : déconnexion et refus", async () => {
    currentClient = fakeSupabase(
      { email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED },
      { amr: [{ method: "password", timestamp: 1 }] },
    );
    const response = await callback("?code=abc");
    expect(currentClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
  });

  it("compte refusé par Supabase (hook ou inscriptions fermées) : « Accès non autorisé »", async () => {
    currentClient = fakeSupabase(null);
    const hook = await callback("?error=access_denied&error_code=&error_description=Acc%C3%A8s+non+autoris%C3%A9");
    expect(hook.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
    const closed = await callback(
      "?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
    );
    expect(closed.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
    // Annulation chez Google : simple erreur de connexion.
    const cancelled = await callback("?error=access_denied&error_description=The+user+denied+the+request");
    expect(cancelled.headers.get("location")).toBe("https://eau.example.app/login?error=auth");
    expect(currentClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(currentClient.auth.signOut).not.toHaveBeenCalled();
  });

  it("ignore tout paramètre de redirection fourni (pas de redirection ouverte)", async () => {
    currentClient = fakeSupabase({ email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED });
    const response = await callback("?code=abc&next=https://evil.example.com");
    expect(response.headers.get("location")).toBe("https://eau.example.app/");
  });
});

describe("proxy (protection des routes admin)", () => {
  async function visit(path: string) {
    const { updateSession } = await import("@/lib/supabase/proxy");
    return updateSession(new NextRequest(`https://eau.example.app${path}`));
  }

  it("sans session : redirection vers /login", async () => {
    currentClient = fakeSupabase(null);
    const response = await visit("/historique");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://eau.example.app/login");
  });

  it("session d'un compte non autorisé : déconnexion + /login?error=unauthorized", async () => {
    currentClient = fakeSupabase({ email: "intrus@gmail.com", email_confirmed_at: CONFIRMED });
    const response = await visit("/parametres");
    expect(currentClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
  });

  it("session de l'admin ouverte par mot de passe : déconnexion + refus", async () => {
    currentClient = fakeSupabase(
      { email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED },
      { amr: [{ method: "password", timestamp: 1 }] },
    );
    const response = await visit("/");
    expect(currentClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://eau.example.app/login?error=unauthorized");
  });

  it("admin : accès autorisé", async () => {
    currentClient = fakeSupabase({ email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED });
    const response = await visit("/");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("/login reste accessible sans session", async () => {
    currentClient = fakeSupabase(null);
    const response = await visit("/login");
    expect(response.headers.get("location")).toBeNull();
  });

  it("le matcher exclut la page Cardinal et le callback, pas les routes admin", async () => {
    const { config } = await import("@/proxy");
    const pattern = new RegExp(`^${config.matcher[0]!}$`);
    for (const path of ["/", "/historique", "/parametres", "/livraisons/nouvelle", "/login", "/paiements"]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/p/abc", "/auth/callback", "/_next/static/x.js", "/sw.js", "/manifest.webmanifest"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});

describe("lien magique de secours", () => {
  beforeEach(() => {
    statelessSignInWithOtp.mockClear();
    afterTasks.length = 0;
  });

  async function submit(email: string) {
    const { sendMagicLink } = await import("@/app/login/actions");
    const { createClient } = await import("@/lib/supabase/server");
    vi.mocked(createClient).mockClear();
    const form = new FormData();
    form.set("email", email);
    const state = await sendMagicLink({ status: "idle" }, form);
    await Promise.all(afterTasks);
    // Jamais de client à cookies : aucune réponse ne pose de cookie PKCE.
    expect(createClient).not.toHaveBeenCalled();
    return state;
  }

  it("n'envoie rien à une adresse non autorisée, avec la même réponse", async () => {
    const result = await submit("intrus@gmail.com");
    expect(statelessSignInWithOtp).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
    expect(result.status).toBe("sent");
  });

  it("envoie le lien à l'adresse admin (casse indifférente), après la réponse, sans créer de compte", async () => {
    const admin = await submit("Admin@Example.com");
    expect(afterTasks).toHaveLength(1);
    expect(statelessSignInWithOtp).toHaveBeenCalledWith({
      email: ADMIN_EMAIL,
      options: { emailRedirectTo: "https://eau.example.app/auth/callback", shouldCreateUser: false },
    });
    const other = await submit("intrus@gmail.com");
    expect(admin).toEqual(other);
  });

  it("utilise un client sans stockage (flux implicite, aucun cookie)", async () => {
    await submit(ADMIN_EMAIL);
    const { createClient } = await import("@supabase/supabase-js");
    expect(createClient).toHaveBeenCalledWith("https://ref.supabase.co", "anon-key", {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("refuse une saisie qui n'est pas un email", async () => {
    expect((await submit("pas-un-email")).status).toBe("invalid");
    expect(statelessSignInWithOtp).not.toHaveBeenCalled();
  });
});
