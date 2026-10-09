import { type ReactNode, createContext, use, useCallback, useMemo, useRef, useState } from 'react'

export interface ToastInput {
  message: ReactNode
  action?: { label: string; onAction: () => void }
  tone?: 'default' | 'error'
}

interface Toast extends ToastInput {
  id: number
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])

  const show = useCallback(
    (input: ToastInput) => {
      const id = ++nextId.current
      setToasts((list) => [...list.slice(-1), { ...input, id }])
      window.setTimeout(() => dismiss(id), input.action ? 6_000 : 3_500)
    },
    [dismiss],
  )

  const value = useMemo(() => show, [show])

  return (
    <ToastContext value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`toast-enter pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl py-2 pl-4 pr-2 text-[0.9375rem] shadow-card ${
              toast.tone === 'error' ? 'bg-danger-soft text-danger-ink ring-1 ring-danger/30' : 'bg-text text-surface'
            }`}
          >
            <span className="min-w-0 flex-1 py-1.5">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className={`min-h-11 shrink-0 rounded-full px-4 font-bold underline-offset-4 hover:underline ${
                  toast.tone === 'error' ? 'text-danger-ink' : 'text-primary-soft'
                }`}
                onClick={() => {
                  toast.action?.onAction()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext>
  )
}

export function useToast(): (toast: ToastInput) => void {
  return use(ToastContext)
}
