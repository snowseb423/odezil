import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// La page Cardinal (/p/[token]) est rendue sans aucun composant client : on
// parcourt tous les modules locaux qu'elle importe, directement ou non.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "app/p/[token]/page.tsx");
/** Paquets qui chargeraient un module client (« use client ») dans la page. */
const FORBIDDEN_PACKAGES = ["lucide-react"];

function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  throw new Error(`Import introuvable : ${specifier} depuis ${from}`);
}

function importGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?[^'"]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
      const statement = match[0];
      const specifier = (match[1] ?? match[2])!;
      if (/^(?:import|export)\s+type\s/.test(statement)) continue; // effacé à la compilation
      const local = resolveLocal(specifier, file);
      if (local) queue.push(local);
      else packages.add(specifier);
    }
  }
  return { files: [...files], packages: [...packages] };
}

describe("page Cardinal : aucun composant client", () => {
  const { files, packages } = importGraph(ENTRY);

  it("parcourt bien la page et sa vue", () => {
    expect(files.some((f) => f.endsWith("components/cardinal-statement-view.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("lib/data/cardinal.ts"))).toBe(true);
  });

  it("aucun module local importé n'est un composant client", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(/^\s*["']use client["']/.test(source), file).toBe(false);
    }
  });

  it("aucun paquet client n'est importé", () => {
    for (const forbidden of FORBIDDEN_PACKAGES) {
      expect(packages, forbidden).not.toContain(forbidden);
    }
  });
});
