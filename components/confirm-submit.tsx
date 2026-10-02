"use client";

import { useFormStatus } from "react-dom";
import { useHydrated } from "@/components/use-hydrated";

type ConfirmSubmitProps = {
  message: string;
  label: string;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Bouton de soumission qui demande confirmation (suppression, révocation…).
 * Désactivé tant que React n'a pas hydraté, pour que la confirmation ne puisse
 * pas être contournée.
 */
export function ConfirmSubmit({ message, label, className, children }: ConfirmSubmitProps) {
  const { pending } = useFormStatus();
  const hydrated = useHydrated();
  return (
    <button
      type="submit"
      aria-label={label}
      disabled={!hydrated || pending}
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children ?? label}
    </button>
  );
}
