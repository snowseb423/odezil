"use client";

import { useActionState } from "react";
import { sendMagicLink, verifyLoginCode, type LoginCodeState, type MagicLinkState } from "./actions";

const initialState: MagicLinkState = { status: "idle" };
const initialCodeState: LoginCodeState = { status: "idle" };

export function MagicLinkForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initialState);
  const [codeState, codeAction, codePending] = useActionState(verifyLoginCode, initialCodeState);

  return (
    <div className="mt-3 space-y-4">
      <form action={action} className="space-y-3">
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
          {pending ? "Envoi…" : state.status === "sent" ? "Renvoyer un code" : "Recevoir un code par email"}
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

      {state.status === "sent" && (
        <form action={codeAction} className="space-y-3">
          <input type="hidden" name="email" value={state.email} />
          <label className="block text-sm font-medium text-slate-700" htmlFor="code">
            Code reçu par email
          </label>
          <input
            id="code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]{6,13}"
            maxLength={13}
            required
            className="input text-center tracking-[0.3em]"
            placeholder="123456"
          />
          <button type="submit" disabled={codePending} className="btn btn-primary w-full">
            {codePending ? "Vérification…" : "Se connecter"}
          </button>
          {codeState.status === "invalid" && (
            <p role="alert" className="text-sm text-red-700">
              {codeState.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
