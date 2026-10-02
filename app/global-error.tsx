"use client";

import "./globals.css";

/**
 * Erreur hors des écrans admin (connexion, page Cardinal) ou dans le layout
 * racine : page générique en français, sans aucun détail technique.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">
        <title>Erreur · EauPartagée</title>
        <meta name="robots" content="noindex, nofollow" />
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
          <p className="text-slate-600">Vérifiez votre connexion, puis réessayez.</p>
          <button type="button" className="btn btn-primary" onClick={() => retry()}>
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
