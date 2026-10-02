import "server-only";
import { createHmac, randomBytes } from "node:crypto";

/** 32 octets aléatoires → 43 caractères base64url. */
export const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function isWellFormedShareToken(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}

/**
 * Hash stocké en base : HMAC-SHA256(pepper, token) en hexadécimal. Sans le
 * pepper (variable d'environnement), une fuite de la table ne permet pas de
 * vérifier des tokens candidats.
 */
export function hashShareToken(token: string, pepper: string): string {
  if (!pepper) throw new Error("SHARE_TOKEN_PEPPER manquant");
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}
