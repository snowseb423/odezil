// Lien de consultation du Foyer 2 : token aléatoire de 32 octets
// (base64url) généré dans le navigateur ; seul son hash SHA-256 (hex) part
// en base. Le lien complet n'est affiché qu'une fois. Génération et
// révocation exigent le réseau.
import type { SupabaseClient } from '@supabase/supabase-js'

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Token de 32 octets aléatoires, en base64url (43 caractères). */
export function generateShareToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** SHA-256 (hex) d'un texte, identique à encode(sha256(convert_to(…, 'UTF8')), 'hex') en SQL. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/p/${token}`
}

/** Crée un nouveau lien (et révoque l'ancien) ; renvoie le lien complet, à n'afficher qu'une fois. */
export async function rotateShareLink(client: SupabaseClient, origin: string): Promise<{ url: string; createdAt: string }> {
  const token = generateShareToken()
  const { data, error } = await client.rpc('rotate_share_link', { p_id: crypto.randomUUID(), p_token_hash: await sha256Hex(token) })
  if (error) throw new Error(error.message)
  return { url: shareUrl(origin, token), createdAt: String((data as { created_at?: string } | null)?.created_at ?? new Date().toISOString()) }
}

export async function revokeShareLinks(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('revoke_share_links')
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
