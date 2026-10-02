"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour les navigateurs sans API Clipboard (ou contexte non sécurisé).
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copier", className = "btn btn-primary w-full text-lg" }: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setStatus((await copyText(text)) ? "copied" : "error");
        setTimeout(() => setStatus("idle"), 2500);
      }}
    >
      {status === "copied" ? <Check className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
      <span aria-live="polite">{status === "copied" ? "Copié !" : status === "error" ? "Copie impossible" : label}</span>
    </button>
  );
}
