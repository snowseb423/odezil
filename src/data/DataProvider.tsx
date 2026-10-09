import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, createContext, use, useEffect, useState, useSyncExternalStore } from 'react'
import { AppDB } from './db.ts'
import { type AppData, clearAll, loadAppData } from './mirror.ts'
import { createSupabaseRemote } from './remote.ts'
import { supabase } from './supabase.ts'
import { SyncEngine, type SyncState } from './sync.ts'

/** Base locale unique de l'application (administrateur). */
export const db = new AppDB()

/** Déconnexion ou refus d'accès : efface les données locales. */
export function clearLocalData(): Promise<void> {
  return clearAll(db)
}

const EngineContext = createContext<SyncEngine | null>(null)

async function refreshAuth(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.auth.refreshSession()
  return !error && Boolean(data.session)
}

/** Moteur de synchronisation de la session (à monter avec key = identifiant de l'utilisateur). */
export function DataProvider({
  onBlocked,
  children,
}: {
  onBlocked?: (blocked: NonNullable<SyncState['blocked']>) => void
  children: ReactNode
}) {
  const [engine] = useState(() => {
    if (!supabase) throw new Error('Supabase n’est pas configuré.')
    return new SyncEngine(db, createSupabaseRemote(supabase), { refreshAuth })
  })

  useEffect(() => {
    engine.setBlockedListener(onBlocked ?? null)
  }, [engine, onBlocked])

  useEffect(() => {
    void engine.start()
    return () => engine.stop()
  }, [engine])

  return <EngineContext value={engine}>{children}</EngineContext>
}

export function useEngine(): SyncEngine {
  const engine = use(EngineContext)
  if (!engine) throw new Error('useEngine() hors de <DataProvider>')
  return engine
}

/** Données affichées : miroir local + écritures en attente, mises à jour en direct. */
export function useAppData(): AppData | undefined {
  return useLiveQuery(() => loadAppData(db), [])
}

export function useSyncState(): SyncState {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getState)
}
