import { AppMark } from './ui/AppMark.tsx'

/** Configuration absente ou invalide : échec fermé, avec le nom des variables en cause (jamais leur valeur). */
export function ConfigScreen({ missing }: { missing: readonly string[] }) {
  return (
    <div className="band flex min-h-dvh flex-col justify-end gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <AppMark size={56} />
      <h1 className="font-display text-3xl font-extrabold">Configuration incomplète</h1>
      <p className="max-w-sm text-header-ink-2">
        L’application n’est pas encore reliée à sa base de données. Renseignez ces variables d’environnement, puis redéployez :
      </p>
      <ul className="flex flex-col gap-1.5">
        {missing.map((name) => (
          <li key={name}>
            <code className="rounded-lg bg-surface/15 px-2 py-1 text-sm font-bold">{name}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}
