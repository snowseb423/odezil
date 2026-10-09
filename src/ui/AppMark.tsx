/** Goutte d'eau stylisée sur fond primary (même dessin que les icônes de l'app). */
export function AppMark({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="EauPartagée" className={className}>
      <rect width="64" height="64" rx="16" fill="var(--primary)" />
      <path d="M32 10.5c-1.2 1.5-14 16.6-14 27.5a14 14 0 0 0 28 0c0-10.9-12.8-26-14-27.5z" fill="var(--bg)" />
      <path d="M24.5 39.5a8 8 0 0 0 7 7" fill="none" stroke="var(--foyer-1)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
