"use client";

import { useActionState } from "react";
import { sendMagicLink, type MagicLinkState } from "./actions";

const initialState: MagicLinkState = { status: "idle" };

export function MagicLinkForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initialState);

  return (
    <form action={action} className="mt-3 space-y-3">
      <label className="block text-sm font-medium text-slate-700" htmlFor="email">
        Adresse email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        className="input"
        placeholder="vous@exemple.com"
      />
      <button type="submit" disabled={pending} className="btn btn-secondary w-full">
        {pending ? "Envoi…" : "Recevoir un lien de connexion"}
      </button>
      {state.status !== "idle" && (
        <p
          role="status"
          className={state.status === "sent" ? "text-sm text-slate-700" : "text-sm text-red-700"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
