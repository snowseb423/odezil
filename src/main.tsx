import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
// Capte beforeinstallprompt dès le chargement, avant l'écran Réglages.
import './pwa/install.ts'
import { routeFromPath } from './lib/router.ts'

// Deux applications distinctes : la page du Foyer 2 (/p/:token) ne charge
// ni l'authentification ni la base locale de l'administrateur.
const AdminApp = lazy(() => import('./App.tsx').then((module) => ({ default: module.App })))
const SharedRoot = lazy(() => import('./share/SharedRoot.tsx'))

const route = routeFromPath(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="band min-h-dvh" aria-busy="true" aria-label="Chargement" />}>
      {route.name === 'share' ? <SharedRoot token={route.token} /> : <AdminApp />}
    </Suspense>
  </StrictMode>,
)
