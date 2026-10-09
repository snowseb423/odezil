import { Copy, Share2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { AppData } from '../data/mirror.ts'
import { bottlesF2, f2Adjustment } from '../domain/calculations.ts'
import { addMonths, monthOf } from '../domain/dates.ts'
import { capitalize, formatMonth, formatRs } from '../domain/format.ts'
import { monthRecap, recapMessage } from '../domain/recap.ts'
import type { IsoDate, IsoMonth } from '../domain/types.ts'
import { Sheet } from '../ui/Sheet.tsx'
import { useToast } from '../ui/Toaster.tsx'
import { Button, Field, Select, textareaClass } from '../ui/controls.tsx'
import { FigureRow } from './shared.tsx'

/** Mois qui concernent le Foyer 2 (bonbonnes ou ajustement), du plus récent au plus ancien. */
export function recapMonths(data: Pick<AppData, 'deliveries' | 'soas'>, today: IsoDate): IsoMonth[] {
  const months = new Set<IsoMonth>()
  for (const d of data.deliveries) if (bottlesF2(d) > 0) months.add(monthOf(d.deliveryDate))
  for (const s of data.soas) if (f2Adjustment(s.varianceCents, s.varianceTreatment) !== 0) months.add(s.month)
  months.add(monthOf(today))
  return [...months].sort().reverse()
}

/** Mois proposé par défaut : le dernier mois terminé qui concerne le Foyer 2, sinon le plus récent. */
export function defaultRecapMonth(data: Pick<AppData, 'deliveries' | 'soas'>, today: IsoDate): IsoMonth {
  const months = recapMonths(data, today)
  const previous = addMonths(monthOf(today), -1)
  return months.find((m) => m <= previous && m !== monthOf(today)) ?? months[0] ?? monthOf(today)
}

async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!fallback) return false
    fallback.select()
    return document.execCommand('copy')
  }
}

/** Message récapitulatif mensuel pour le Foyer 2, prêt pour WhatsApp. */
export function RecapSheet({ data, today, initialMonth, onClose }: { data: AppData; today: IsoDate; initialMonth?: IsoMonth; onClose: () => void }) {
  const toast = useToast()
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  // Sans choix explicite, le mois proposé suit les données (encore en cours de chargement à l'ouverture).
  const [chosenMonth, setMonth] = useState<IsoMonth | null>(initialMonth ?? null)
  const month = chosenMonth ?? defaultRecapMonth(data, today)
  const recap = monthRecap(month, data)
  const message = recapMessage(recap)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <Sheet
      open
      onClose={onClose}
      title="Message récapitulatif"
      subtitle="Uniquement les bonbonnes du Foyer 2"
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          {canShare ? (
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.share({ text: message }).catch(() => undefined)
              }}
            >
              <Share2 size={18} aria-hidden="true" />
              Partager
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={async () => {
              const ok = await copyText(message, area.current)
              toast(ok ? { message: 'Message copié : collez-le dans WhatsApp.' } : { tone: 'error', message: 'Copie impossible : sélectionnez le texte.' })
            }}
          >
            <Copy size={18} aria-hidden="true" />
            Copier
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Mois" htmlFor={`${id}-month`}>
          <Select id={`${id}-month`} value={month} onChange={(event) => setMonth(event.target.value)}>
            {recapMonths(data, today).map((m) => (
              <option key={m} value={m}>
                {capitalize(formatMonth(m))}
              </option>
            ))}
          </Select>
        </Field>
        <dl className="rounded-2xl border border-border px-4 py-2">
          <FigureRow label="Bonbonnes du Foyer 2" value={recap.bottles} />
          <FigureRow label="Montant du mois" value={formatRs(recap.monthCents)} />
          <FigureRow label="Solde antérieur" value={formatRs(recap.previousBalanceCents)} />
          <FigureRow label="Total à régler" value={formatRs(recap.totalCents)} strong />
        </dl>
        <Field label="Texte du message" htmlFor={`${id}-text`}>
          <textarea id={`${id}-text`} ref={area} readOnly className={`${textareaClass} min-h-40`} value={message} />
        </Field>
      </div>
    </Sheet>
  )
}
