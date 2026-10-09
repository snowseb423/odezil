import { type SupabaseClient, createClient } from '@supabase/supabase-js'
import { env } from '../env.ts'

/** Clé du stockage local de la session Supabase (et du code_verifier PKCE). */
export const AUTH_STORAGE_KEY = 'eaupartagee-auth'

/**
 * Client Supabase de l'administrateur (session persistée, renouvelée
 * automatiquement). Flux PKCE : le retour de Google ou du lien magique
 * arrive sur /auth/callback avec un code, échangé dans ce navigateur.
 * Null si la configuration est absente (écran « Configuration incomplète »).
 */
export const supabase: SupabaseClient | null = env.configured
  ? createClient(env.supabaseUrl, env.supabaseKey, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null
