import { type ReactNode, useEffect } from 'react'
import { useAuth } from './auth/AuthProvider.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { LoginScreen } from './auth/LoginScreen.tsx'
import { ConfigScreen } from './ConfigScreen.tsx'
import { DataProvider, clearLocalData, useAppData } from './data/DataProvider.tsx'
import { AppShell } from './layout/AppShell.tsx'
import { useToday } from './lib/useToday.ts'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { JournalScreen } from './screens/JournalScreen.tsx'
import { env } from './env.ts'
import { navigate, useLocation } from './lib/router.ts'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { AppMark } from './ui/AppMark.tsx'
import { ToastProvider, useToast } from './ui/Toaster.tsx'
import { Button } from './ui/controls.tsx'

export function Splash({ label = 'Chargement' }: { label?: string }) {
  return (
    <div className="band grid min-h-dvh place-items-center" aria-busy="true" aria-label={label}>
      <div className="flex flex-col items-center gap-4">
        <AppMark size={72} className="motion-safe:animate-pulse" />
        {label !== 'Chargement' ? <p className="text-header-ink-2">{label}</p> : null}
      </div>
    </div>
  )
}

function CheckFailed({ message }: { message: string }) {
  const { retryCheck, signOut } = useAuth()
  return (
    <div className="band flex min-h-dvh flex-col items-start justify-end gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <AppMark size={56} />
      <h1 className="font-display text-3xl font-extrabold">Vérification impossible</h1>
      <p className="max-w-sm text-header-ink-2">{message}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={retryCheck}>
          Réessayer
        </Button>
        <Button variant="ghost" className="text-header-ink hover:bg-surface/10" onClick={() => void signOut()}>
          Se déconnecter
        </Button>
      </div>
    </div>
  )
}

/** Après le retour de Google ou d'un lien magique : vers l'accueil. */
function LeaveCallback({ children }: { children: ReactNode }) {
  const { route } = useLocation()
  useEffect(() => {
    if (route.name === 'authCallback') navigate('/', { replace: true })
  }, [route.name])
  return route.name === 'authCallback' ? <Splash /> : children
}

function Main() {
  const data = useAppData()
  const today = useToday()
  const { route } = useLocation()
  const { signOut } = useAuth()
  if (!data) return <Splash />
  switch (route.name) {
    case 'journal':
      return <JournalScreen data={data} today={today} />
    case 'deliveries':
    case 'months':
    case 'balance':
    case 'settings':
      return (
        <AppShell title="Bientôt">
          <p className="text-text-muted">Écran en construction.</p>
          <Button className="mt-4" variant="secondary" onClick={() => void signOut()}>
            Se déconnecter
          </Button>
        </AppShell>
      )
    default:
      return <HomeScreen data={data} />
  }
}

function SessionData({ children }: { children: ReactNode }) {
  const toast = useToast()
  return (
    <DataProvider onBlocked={(blocked) => toast({ tone: 'error', message: `Refusé par le serveur : ${blocked.label}. ${blocked.message}` })}>
      {children}
    </DataProvider>
  )
}

/** Garde de routes : rien de l'app sans session vérifiée (is_admin). */
function Gate() {
  const { state } = useAuth()
  switch (state.status) {
    case 'loading':
      return <Splash />
    case 'signedOut':
      // Nouvelle clé à chaque message : l'écran repart de l'état initial.
      return <LoginScreen key={state.message ?? ''} message={state.message} />
    case 'checking':
      return <Splash label="Vérification de l’accès…" />
    case 'checkFailed':
      return <CheckFailed message={state.message} />
    case 'signedIn':
      return (
        <LeaveCallback>
          <SessionData key={state.user.id}>
            <Main />
          </SessionData>
        </LeaveCallback>
      )
  }
}

export function App() {
  if (!env.configured) return <ConfigScreen missing={env.missing} />
  return (
    <ToastProvider>
      <AuthProvider onSignedOut={clearLocalData}>
        <Gate />
      </AuthProvider>
      <UpdatePrompt />
    </ToastProvider>
  )
}
