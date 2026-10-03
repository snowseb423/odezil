import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigurationError,
  adminEmail,
  configurationProblems,
  loginConfigurationProblems,
  supabaseAnonKey,
  supabaseServiceRoleKey,
} from "@/lib/env";

const COMPLETE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_SECRET_KEY: "",
  ADMIN_EMAIL: "Admin@Example.com",
  SHARE_TOKEN_PEPPER: "x".repeat(32),
};

function setEnv(overrides: Partial<Record<keyof typeof COMPLETE, string>> = {}) {
  for (const [key, value] of Object.entries({ ...COMPLETE, ...overrides })) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("diagnostic de configuration", () => {
  it("aucun problème quand tout est renseigné", () => {
    setEnv();
    expect(configurationProblems()).toEqual([]);
    expect(adminEmail()).toBe("admin@example.com");
  });

  it("ADMIN_EMAIL absente : bloque la connexion (cause de l'erreur 500 au retour de Google)", () => {
    setEnv({ ADMIN_EMAIL: "" });
    expect(loginConfigurationProblems()).toEqual([
      { variable: "ADMIN_EMAIL", message: "Variable d'environnement manquante : ADMIN_EMAIL", blocksLogin: true },
    ]);
  });

  it.each(['"admin@example.com"', "'admin@example.com'", "admin@example", "admin example.com", "<admin@example.com>"])(
    "ADMIN_EMAIL invalide (%s) : signalée clairement",
    (value) => {
      setEnv({ ADMIN_EMAIL: value });
      expect(() => adminEmail()).toThrow(ConfigurationError);
      expect(loginConfigurationProblems().map((p) => p.variable)).toEqual(["ADMIN_EMAIL"]);
    },
  );

  it("SHARE_TOKEN_PEPPER et clé service_role : signalées sans bloquer la connexion", () => {
    setEnv({ SHARE_TOKEN_PEPPER: "court", SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(loginConfigurationProblems()).toEqual([]);
    expect(configurationProblems().map((p) => [p.variable, p.blocksLogin])).toEqual([
      ["SUPABASE_SERVICE_ROLE_KEY", false],
      ["SHARE_TOKEN_PEPPER", false],
    ]);
  });

  it("ne révèle jamais la valeur des variables", () => {
    setEnv({ ADMIN_EMAIL: '"secret.admin@example.com"', SHARE_TOKEN_PEPPER: "pepper-court" });
    const text = JSON.stringify(configurationProblems());
    expect(text).not.toContain("secret.admin");
    expect(text).not.toContain("pepper-court");
  });

  it("accepte les nouveaux noms de clés Supabase (publishable / secret)", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_SECRET_KEY: "sb_secret_x",
    });
    expect(supabaseAnonKey()).toBe("sb_publishable_x");
    expect(supabaseServiceRoleKey()).toBe("sb_secret_x");
    expect(configurationProblems()).toEqual([]);
  });
});
