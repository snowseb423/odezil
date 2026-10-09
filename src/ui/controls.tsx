import { ChevronDown, Minus, Plus } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary shadow-sm hover:bg-primary-hover',
  secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-2',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'border border-danger/40 bg-surface text-danger-ink hover:bg-danger-soft',
  quiet: 'bg-surface-2 text-text hover:bg-surface-3',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full font-bold transition-[transform,background-color,filter] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${
        size === 'lg' ? 'min-h-13 px-6 text-base' : 'min-h-11 px-5 text-[0.9375rem]'
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-3xl border border-border bg-surface shadow-card ${padded ? 'p-4' : 'overflow-hidden'} ${className}`}>
      {children}
    </section>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="font-display text-lg font-bold text-text">{children}</h2>
      {action}
    </div>
  )
}

/** Réglage d'une quantité entière par pas. Cibles de 44 px minimum. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 99,
  label,
  format = String,
  disabled,
  size = 'md',
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  label: string
  format?: (value: number) => string
  disabled?: boolean
  size?: 'md' | 'lg'
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  const buttonSize = size === 'lg' ? 'size-14' : 'size-11'
  return (
    <div className="inline-flex items-center rounded-full border border-border-strong bg-surface" role="group" aria-label={label}>
      <button
        type="button"
        className={`grid ${buttonSize} place-items-center rounded-full text-text hover:bg-surface-2 disabled:opacity-40`}
        onClick={() => onChange(clamp(value - step))}
        disabled={disabled || value <= min}
        aria-label={`Diminuer : ${label.toLowerCase()}`}
      >
        <Minus size={size === 'lg' ? 24 : 18} aria-hidden="true" />
      </button>
      <output
        className={`num text-center font-bold text-text ${size === 'lg' ? 'min-w-20 font-display text-3xl' : 'min-w-14'}`}
        aria-live="polite"
      >
        {format(value)}
      </output>
      <button
        type="button"
        className={`grid ${buttonSize} place-items-center rounded-full text-text hover:bg-surface-2 disabled:opacity-40`}
        onClick={() => onChange(clamp(value + step))}
        disabled={disabled || value >= max}
        aria-label={`Augmenter : ${label.toLowerCase()}`}
      >
        <Plus size={size === 'lg' ? 24 : 18} aria-hidden="true" />
      </button>
    </div>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: ReactNode
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[0.9375rem] font-bold text-text">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-text-muted">{hint}</p> : null}
    </div>
  )
}

const fieldClass =
  'w-full rounded-2xl border border-border-strong bg-surface px-4 text-base text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-1'

export const inputClass = `min-h-12 ${fieldClass}`

export const textareaClass = `min-h-24 resize-y py-3 ${fieldClass}`

/** Liste déroulante native, à l'apparence des champs de saisie. */
export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={`${inputClass} appearance-none pr-11 ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown
        size={18}
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-muted"
        aria-hidden="true"
      />
    </div>
  )
}

/** Message d'alerte en ligne : avertissement (attribution, écart) ou erreur. */
export function Notice({
  tone = 'warning',
  children,
  className = '',
}: {
  tone?: 'warning' | 'danger' | 'info' | 'success'
  children: ReactNode
  className?: string
}) {
  const tones = {
    warning: 'bg-warning-soft text-warning-ink ring-warning/40',
    danger: 'bg-danger-soft text-danger-ink ring-danger/40',
    info: 'bg-primary-soft text-primary ring-primary/30',
    success: 'bg-success-soft text-success-ink ring-success/40',
  } as const
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-2xl p-3 text-[0.9375rem] ring-1 ${tones[tone]} ${className}`}>
      {children}
    </div>
  )
}
