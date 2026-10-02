"use client";

import { useActionState } from "react";
import { MAX_REPAYMENT_NOTE_LENGTH } from "@/lib/repayment-input";
import { createRepayment, type RepaymentFormState } from "./actions";

const initialState: RepaymentFormState = { error: null };

export function RepaymentForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createRepayment, initialState);

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="repayment-date">
            Date
          </label>
          <input
            id="repayment-date"
            name="repaymentDate"
            type="date"
            className="input"
            defaultValue={today}
            max={today}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="repayment-amount">
            Montant (Rs)
          </label>
          <input
            id="repayment-amount"
            name="amount"
            className="input tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1 200"
            required
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="repayment-note">
          Note (facultatif)
        </label>
        <input
          id="repayment-note"
          name="note"
          className="input text-base"
          maxLength={MAX_REPAYMENT_NOTE_LENGTH}
          placeholder="Espèces, virement, juillet + août…"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full text-lg" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le remboursement"}
      </button>
    </form>
  );
}
