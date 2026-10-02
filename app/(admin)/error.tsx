"use client";

/**
 * Erreur dans un écran admin (réseau, base indisponible…) : message en
 * français, la navigation basse reste affichée.
 */
export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main role="alert" className="card space-y-3">
      <h1 className="text-lg font-semibold">Une erreur est survenue</h1>
      <p className="text-slate-600">L&apos;opération n&apos;a pas pu aboutir. Vérifiez la connexion, puis réessayez.</p>
      <button type="button" className="btn btn-primary w-full" onClick={() => retry()}>
        Réessayer
      </button>
    </main>
  );
}
