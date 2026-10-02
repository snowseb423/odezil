"use client";

import { useActionState } from "react";
import { Ban, Link2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { CopyButton } from "@/components/copy-button";
import { generateShareLink, revokeShareLink, type ShareLinkState } from "./actions";

const initialState: ShareLinkState = { status: "idle" };

export function ShareLinkPanel({ activeSince }: { activeSince: string | null }) {
  const [state, action, pending] = useActionState(generateShareLink, initialState);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {activeSince
          ? `Un lien est actif depuis le ${activeSince}. Il n'est plus affichable : générez-en un nouveau si besoin (l'ancien cessera de fonctionner).`
          : "Aucun lien actif."}
      </p>

      {state.status === "created" && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            Nouveau lien créé. Copiez-le maintenant : il ne sera plus jamais affiché.
          </p>
          <p className="rounded-lg bg-white p-2 font-mono text-xs break-all select-all">{state.url}</p>
          <CopyButton text={state.url} label="Copier le lien" />
        </div>
      )}
      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {state.message}
        </p>
      )}

      <form action={action}>
        <button
          type="submit"
          className="btn btn-secondary w-full"
          disabled={pending}
          onClick={(event) => {
            if (activeSince && !window.confirm("Générer un nouveau lien ? L'ancien cessera immédiatement de fonctionner.")) {
              event.preventDefault();
            }
          }}
        >
          <Link2 className="h-5 w-5" aria-hidden="true" />
          {pending ? "Génération…" : activeSince ? "Générer un nouveau lien" : "Générer le lien"}
        </button>
      </form>

      {activeSince && (
        <form action={revokeShareLink}>
          <ConfirmSubmit
            label="Révoquer le lien"
            message="Révoquer le lien ? La page du Cardinal ne sera plus accessible."
            className="btn btn-danger w-full"
          >
            <Ban className="h-5 w-5" aria-hidden="true" />
            Révoquer le lien
          </ConfirmSubmit>
        </form>
      )}
    </div>
  );
}
