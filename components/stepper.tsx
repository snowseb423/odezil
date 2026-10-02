"use client";

import { Minus, Plus } from "lucide-react";

type StepperProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  hint?: string;
};

/** Compteur à gros boutons − / +, utilisable au pouce. */
export function Stepper({ label, value, onChange, min = 0, max, hint }: StepperProps) {
  const id = `stepper-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="card">
      <div className="flex items-baseline justify-between">
        <span id={id} className="text-base font-semibold text-slate-900">
          {label}
        </span>
        {hint && <span className="text-sm text-slate-600 tabular-nums">{hint}</span>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3" role="group" aria-labelledby={id}>
        <button
          type="button"
          className="btn btn-secondary h-16 w-16 shrink-0 rounded-full p-0"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Retirer une bonbonne (${label})`}
        >
          <Minus className="h-7 w-7" aria-hidden="true" />
        </button>
        <output className="min-w-16 text-center text-5xl font-bold tabular-nums" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="btn btn-primary h-16 w-16 shrink-0 rounded-full p-0"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Ajouter une bonbonne (${label})`}
        >
          <Plus className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
