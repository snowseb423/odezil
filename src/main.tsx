import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
// Capte beforeinstallprompt dès le chargement, avant l'écran Réglages.
import './pwa/install.ts'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
