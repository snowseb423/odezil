import { useEffect } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { ConfigScreen } from '../ConfigScreen.tsx'
import { env } from '../env.ts'
import { SharedApp } from './SharedApp.tsx'

/** Point d'entrée de la page du Foyer 2 (chargé à part de l'app administrateur). */
export default function SharedRoot({ token }: { token: string }) {
  useEffect(() => {
    // Service worker sans invite de mise à jour : la page s'ouvre hors ligne
    // avec un message clair au lieu d'une erreur du navigateur.
    void registerSW({ immediate: true })
  }, [])
  if (!env.supabaseUrl || !env.supabaseKey) return <ConfigScreen missing={env.missing.filter((name) => !name.startsWith('VITE_ADMIN_EMAIL'))} />
  return <SharedApp token={token} />
}
