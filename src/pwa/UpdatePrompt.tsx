import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../ui/controls.tsx'

const HOUR = 60 * 60 * 1000

/** Enregistre le service worker et propose la nouvelle version quand elle est prête. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Vérifie les mises à jour toutes les heures quand l'app reste ouverte.
      if (registration) window.setInterval(() => void registration.update(), HOUR)
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+4rem)] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-surface p-3 pl-4 text-text shadow-card ring-1 ring-border"
    >
      <p className="min-w-0 flex-1 text-[0.9375rem] font-bold">Nouvelle version disponible</p>
      <Button variant="quiet" onClick={() => setNeedRefresh(false)}>
        Plus tard
      </Button>
      <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
        Mettre à jour
      </Button>
    </div>
  )
}
