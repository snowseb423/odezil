"use client";

import { useState, useTransition } from "react";
import { VARIANCE_TREATMENTS, computeVariance, type VarianceTreatment } from "@/lib/calculations";
import { TREATMENT_LABELS } from "@/lib/labels";
import { formatRs, formatRsSigned, parseRsToCents } from "@/lib/money";
import { MAX_SOA_NOTE_LENGTH } from "@/lib/soa-input";
import { saveSoa } from "./actions";

type SoaFormProps = {
  month: string;
  expectedTotal: number;
  initialTotal: string;
  initialTreatment: VarianceTreatment | null;
  initialNote: string;
};

export function SoaForm({ month, expectedTotal, initialTotal, initialTreatment, initialNote }: SoaFormProps) {
  const [total, setTotal] = useState(initialTotal);
  const [treatment, setTreatment] = useState<VarianceTreatment | null>(initialTreatment);
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalCents = total.trim() === "" ? null : parseRsToCents(total);
  const variance = totalCents === null ? null : computeVariance(totalCents, expectedTotal);
  const needsTreatment = variance !== null && variance !== 0;
  const canSubmit = !pending && variance !== null && (!needsTreatment || treatment !== null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await saveSoa({ month, totalBilled: total, treatment: needsTreatment ? treatment : null, note });
      // En cas de succès, l'action recharge la page.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="soa-total">
          Total du SOA (Rs)
        </label>
        <input
          id="soa-total"
          className="input tabular-nums"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ex. 2 880,00"
          value={total}
          onChange={(event) => setTotal(event.target.value)}
          aria-invalid={total.trim() !== "" && totalCents === null}
          required
        />
        {total.trim() !== "" && totalCents === null && (
          <p className="mt-1.5 text-sm text-red-700">Montant invalide (ex. 1 200,00).</p>
        )}
      </div>

      <dl className="card space-y-2 tabular-nums">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">Total attendu (livraisons)</dt>
          <dd className="font-semibold">{formatRs(expectedTotal)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">Total SOA</dt>
          <dd className="font-semibold">{totalCents === null ? "—" : formatRs(totalCents)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-slate-100 pt-2">
          <dt className="font-semibold">Écart</dt>
          <dd
            className={`text-lg font-bold ${
              variance === null ? "text-slate-400" : variance === 0 ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {variance === null ? "—" : formatRsSigned(variance)}
          </dd>
        </div>
        {variance !== null && variance !== 0 && (
          <p className="text-sm text-amber-800">
            {variance > 0
              ? "Odezil a facturé plus que les livraisons saisies (livraison oubliée ?)."
              : "Odezil a facturé moins que les livraisons saisies (livraison en trop ?)."}
          </p>
        )}
        {variance === 0 && <p className="text-sm text-emerald-800">Le SOA correspond aux livraisons saisies.</p>}
      </dl>

      {needsTreatment && (
        <fieldset className="card">
          <legend className="sr-only">Traitement de l&apos;écart</legend>
          <p className="label">Comment traiter cet écart ?</p>
          <div className="space-y-2">
            {VARIANCE_TREATMENTS.map((value) => (
              <label
                key={value}
                className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 ${
                  treatment === value ? "border-sky-600 bg-sky-50" : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  name="treatment"
                  value={value}
                  checked={treatment === value}
                  onChange={() => setTreatment(value)}
                  className="h-5 w-5 accent-sky-700"
                />
                <span className="font-medium">{TREATMENT_LABELS[value]}</span>
              </label>
            ))}
          </div>
          {treatment === null && <p className="mt-2 text-sm text-amber-800">Choisissez un traitement pour valider.</p>}
        </fieldset>
      )}

      <div>
        <label className="label" htmlFor="soa-note">
          Note (facultatif)
        </label>
        <textarea
          id="soa-note"
          className="input min-h-20 py-3 text-base"
          maxLength={MAX_SOA_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full text-lg" disabled={!canSubmit}>
        {pending ? "Enregistrement…" : "Valider le rapprochement"}
      </button>
    </form>
  );
}
