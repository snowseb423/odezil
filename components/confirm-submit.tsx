"use client";

import { useFormStatus } from "react-dom";

type ConfirmSubmitProps = {
  message: string;
  label: string;
  className?: string;
  children?: React.ReactNode;
};

/** Bouton de soumission qui demande confirmation (suppression, révocation…). */
export function ConfirmSubmit({ message, label, className, children }: ConfirmSubmitProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children ?? label}
    </button>
  );
}
