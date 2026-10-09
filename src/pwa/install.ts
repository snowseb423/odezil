// Invite d'installation : l'événement beforeinstallprompt (Chrome, Edge,
// Android) est capturé dès le chargement pour être proposé plus tard depuis
// les réglages. iOS ne l'expose pas : on affiche une aide à la place.
import { useSyncExternalStore } from 'react'
import { isIos, isStandalone } from '../lib/platform.ts'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const event = deferred
  await event.prompt()
  const { outcome } = await event.userChoice
  deferred = null
  emit()
  return outcome === 'accepted'
}

export function useInstallState(): { canPrompt: boolean; standalone: boolean; installed: boolean; ios: boolean } {
  const canPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false)
  const justInstalled = useSyncExternalStore(subscribe, () => installed, () => false)
  return { canPrompt, standalone: isStandalone(), installed: justInstalled, ios: isIos() }
}
