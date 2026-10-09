import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'

/**
 * Feuille basse modale sur <dialog> natif : piège du focus, touche Échap,
 * arrière-plan inerte, fermeture par clic sur le voile.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- clic sur le voile ; Échap ferme nativement le <dialog>.
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose()
      }}
      onClick={(event) => {
        // Un clic hors du contenu atterrit sur le <dialog> lui-même (voile).
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="flex shrink-0 justify-center pt-2.5" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>
        <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-2">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-xl font-bold leading-tight text-text">
              {title}
            </h2>
            {subtitle ? <div className="mt-0.5 text-[0.9375rem] text-text-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-2"
            aria-label="Fermer"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-surface px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
            {footer}
          </div>
        ) : (
          <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
        )}
      </div>
    </dialog>
  )
}
