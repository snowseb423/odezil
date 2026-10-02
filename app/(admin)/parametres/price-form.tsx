"use client";

import { useActionState } from "react";
import { addPrice, type PriceFormState } from "./actions";

const initialState: PriceFormState = { error: null, saved: false };

export function PriceForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addPrice, initialState);

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="unit-price">
            Nouveau prix (Rs)
          </label>
          <input
            id="unit-price"
            name="unitPrice"
            defaultValue={state.values?.unitPrice}
            className="input tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            placeholder="240,00"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="effective-from">
            À partir du
          </label>
          <input
            id="effective-from"
            name="effectiveFrom"
            type="date"
            className="input"
            defaultValue={state.values?.effectiveFrom ?? today}
            required
          />
        </div>
      </div>
      <p className="text-sm text-slate-600">Les livraisons déjà saisies gardent leur prix.</p>
      {state.error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && (
        <p role="status" className="text-sm font-medium text-emerald-800">
          Prix enregistré.
        </p>
      )}
      <button type="submit" className="btn btn-secondary w-full" disabled={pending}>
        {pending ? "Enregistrement…" : "Ajouter ce prix"}
      </button>
    </form>
  );
}
