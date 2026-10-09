// Contraste AA garanti par construction : chaque paire texte/fond utilisée
// dans l'interface est vérifiée sur les tokens de tokens.css.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '..', 'src/styles/tokens.css'), 'utf8')

function block(selector: RegExp): Record<string, string> {
  const start = css.search(selector)
  if (start < 0) throw new Error(`Bloc introuvable : ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const tokens: Record<string, string> = {}
  for (const match of css.slice(open, end).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[match[1]!] = match[2]!.toLowerCase()
  }
  return tokens
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const tokens = block(/^:root\s*\{/m)

/** Texte (AA, 4,5:1). */
const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'surface-3'], ['text', 'primary-soft'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'],
  ['primary', 'bg'], ['primary', 'surface'], ['primary', 'surface-2'], ['primary', 'primary-soft'],
  ['on-primary', 'primary'], ['on-primary', 'primary-hover'],
  ['foyer-1-ink', 'surface'], ['foyer-1-ink', 'bg'], ['foyer-1-ink', 'foyer-1-soft'],
  ['foyer-2-ink', 'surface'], ['foyer-2-ink', 'bg'], ['foyer-2-ink', 'foyer-2-soft'],
  ['success-ink', 'surface'], ['success-ink', 'bg'], ['success-ink', 'success-soft'],
  ['warning-ink', 'surface'], ['warning-ink', 'bg'], ['warning-ink', 'warning-soft'],
  ['danger-ink', 'surface'], ['danger-ink', 'bg'], ['danger-ink', 'danger-soft'],
  ['header-ink', 'header-bg'], ['header-ink-2', 'header-bg'], ['header-accent', 'header-bg'],
]

/** Éléments graphiques porteurs de sens (pastilles, bordures de champs) : 3:1. */
const GRAPHIC_PAIRS: [string, string][] = [
  ['foyer-1', 'surface'], ['foyer-2', 'surface'], ['success', 'surface'], ['warning', 'surface'], ['danger', 'surface'],
  ['border-strong', 'surface'], ['border-strong', 'bg'], ['focus', 'surface'], ['focus', 'bg'],
]

describe('contrastes de la palette froide', () => {
  it.each(TEXT_PAIRS)('%s sur %s ≥ 4,5:1', (fg, bg) => {
    expect(tokens[fg]).toBeDefined()
    expect(tokens[bg]).toBeDefined()
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(GRAPHIC_PAIRS)('%s sur %s ≥ 3:1', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3)
  })

  it('aucune teinte chaude hors warning et danger', () => {
    const warm = Object.entries(tokens).filter(([name, hex]) => {
      if (/^(warning|danger)/.test(name)) return false
      const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
      // Teinte chaude : rouge dominant nettement sur le bleu.
      return r - b > 24
    })
    expect(warm).toEqual([])
  })
})
