import type { ReactNode } from 'react'
import { Sheet } from './Sheet.tsx'
import { Button } from './controls.tsx'

/** Confirmation explicite d'une action (suppression, recalcul, attribution au Foyer 2…). */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: ReactNode
  children?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="quiet" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[0.9375rem] text-text">{children}</div>
    </Sheet>
  )
}
