import { ConfigScreen } from './ConfigScreen.tsx'
import { env } from './env.ts'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { AppMark } from './ui/AppMark.tsx'

export function App() {
  if (!env.configured) return <ConfigScreen missing={env.missing} />
  return (
    <>
      <div className="band grid min-h-dvh place-items-center" aria-busy="true" aria-label="Chargement">
        <AppMark size={72} className="motion-safe:animate-pulse" />
      </div>
      <UpdatePrompt />
    </>
  )
}
