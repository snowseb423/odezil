import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Droplets } from "lucide-react";
import { LOGIN_ERRORS, isAuthorizedAdmin, isLoginError } from "@/lib/auth-rules";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { adminEmail, configurationProblems } from "@/lib/env";
import { pwaMetadata } from "@/lib/pwa-metadata";
import { createClient } from "@/lib/supabase/server";
import { signInWithGoogle } from "./actions";
import { MagicLinkForm } from "./magic-link-form";

export const metadata: Metadata = {
  ...pwaMetadata,
  title: "Connexion",
  robots: { index: false, follow: false },
};

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-6 w-6">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorKey = Array.isArray(error) ? error[0] : error;

  // Diagnostic de configuration : noms des variables seulement, jamais leurs valeurs.
  const problems = configurationProblems();
  const loginBlocked = problems.some((problem) => problem.blocksLogin);

  // Déjà connecté en tant qu'admin : direction l'accueil.
  if (!loginBlocked) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: claims } = user ? await supabase.auth.getClaims() : { data: null };
    if (user && isAuthorizedAdmin(user, adminEmail(), claims?.claims.amr)) {
      redirect("/");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-10 text-center">
        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-700 text-white shadow-lg">
          <Droplets className="h-9 w-9" aria-hidden="true" />
        </span>
        <h1 className="text-3xl font-bold tracking-tight">EauPartagée</h1>
        <p className="mt-2 text-slate-600">Suivi des bonbonnes Odezil</p>
      </div>

      {problems.length > 0 && (
        <section role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">
            {loginBlocked ? "Connexion impossible : configuration du serveur incomplète." : "Configuration du serveur incomplète."}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((problem) => (
              <li key={problem.variable}>{problem.message}</li>
            ))}
          </ul>
          <p className="mt-2">
            Ajoutez ces variables dans Vercel (<em>Settings &gt; Environment Variables</em>, environnement Production), puis
            redéployez. Voir le README, § 5.
          </p>
        </section>
      )}

      {/* « config » : l'encadré ci-dessus donne déjà le détail (ou le problème est corrigé). */}
      {isLoginError(errorKey) && errorKey !== "config" && (
        <p role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-center font-medium text-red-800">
          {LOGIN_ERRORS[errorKey]}
        </p>
      )}

      {/*
        App installée (écran d'accueil) : pas de Google. iOS ouvrirait Google dans
        une vue Safari séparée, dont la session est perdue à la fermeture de
        l'app ; le code par email se saisit sans quitter l'application.
      */}
      <form action={signInWithGoogle} className="standalone:hidden">
        <button
          type="submit"
          disabled={loginBlocked}
          className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-6 text-lg font-semibold text-slate-900 shadow-sm transition active:scale-[0.98] active:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GoogleLogo />
          Se connecter avec Google
        </button>
      </form>

      <section className="mt-10 rounded-xl border border-slate-200 bg-white/60 p-4 text-sm standalone:mt-0">
        <h2 className="font-medium text-slate-700">
          <span className="standalone:hidden">Problème avec Google ? Recevoir un code par email</span>
          <span className="hidden standalone:inline">Connexion par code reçu par email</span>
        </h2>
        <MagicLinkForm />
      </section>
      <ServiceWorkerRegistration />
    </main>
  );
}
