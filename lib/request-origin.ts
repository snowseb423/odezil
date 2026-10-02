import "server-only";
import { headers } from "next/headers";

/**
 * Origine publique de la requête (ex. https://eau.vercel.app), pour construire
 * les URLs de redirection OAuth / lien magique et le lien Cardinal.
 * Supabase n'accepte de toute façon que les URLs de sa liste « Redirect URLs ».
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) {
    return origin;
  }
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    throw new Error("Hôte de la requête introuvable");
  }
  const forwardedProto = h.get("x-forwarded-proto");
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
        ? "http"
        : "https";
  return `${proto}://${host}`;
}
