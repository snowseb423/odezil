import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { addReplacementOp, deleteReplacementOp, editReplacementOp } from '../data/commands.ts'
import type { AppData } from '../data/mirror.ts'
import type { EffectiveReplacement } from '../data/ops.ts'
import { consumptionByMonth, weeklyAverage } from '../domain/calculations.ts'
import { mauritiusDateOf, mauritiusTimeOf, monthOf } from '../domain/dates.ts'
import { capitalize, formatDateLong, formatDecimal, formatMonth, plural } from '../domain/format.ts'
import type { IsoDate } from '../domain/types.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { Button, Card, Field, SectionTitle, inputClass, textareaClass } from '../ui/controls.tsx'
import { ReplacementRow } from './ReplacementRow.tsx'
import { useCommit } from './useCommit.ts'

function groupByDay(replacements: readonly EffectiveReplacement[]): [IsoDate, EffectiveReplacement[]][] {
  const groups = new Map<IsoDate, EffectiveReplacement[]>()
  for (const replacement of replacements) {
    const day = mauritiusDateOf(replacement.replacedAt)
    groups.set(day, [...(groups.get(day) ?? []), replacement])
  }
  return [...groups.entries()]
}

export function JournalScreen({ data, today }: { data: AppData; today: IsoDate }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<EffectiveReplacement | null>(null)
  const deliveries = new Map(data.deliveries.map((d) => [d.id, d]))
  const months = consumptionByMonth(data.replacements)
  const thisMonth = months.find((m) => m.month === monthOf(today))?.count ?? 0
  const average = weeklyAverage(data.replacements, today)

  const hero = (
    <div className="grid grid-cols-2 gap-3 pt-1">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.12em] text-header-ink-2">Ce mois-ci</p>
        <p className="num font-display text-[2.5rem] font-extrabold leading-tight">{thisMonth}</p>
        <p className="text-sm text-header-ink-2">{thisMonth >= 2 ? 'bonbonnes remplacées' : 'bonbonne remplacée'}</p>
      </div>
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.12em] text-header-ink-2">Moyenne</p>
        <p className="num font-display text-[2.5rem] font-extrabold leading-tight">{average === null ? '—' : formatDecimal(average)}</p>
        <p className="text-sm text-header-ink-2">par semaine</p>
      </div>
    </div>
  )

  return (
    <AppShell title="Journal" hero={hero}>
      <Button variant="secondary" size="lg" className="w-full" onClick={() => setAdding(true)}>
        <Plus size={20} aria-hidden="true" />
        Ajouter un remplacement oublié
      </Button>

      {data.replacements.length === 0 ? (
        <Card className="mt-5">
          <p className="text-[0.9375rem] text-text-muted">Aucun remplacement enregistré pour l’instant.</p>
        </Card>
      ) : (
        groupByDay(data.replacements).map(([day, replacements]) => (
          <section key={day} className="mt-7">
            <SectionTitle>
              {capitalize(formatDateLong(day))} <span className="font-sans text-base font-bold text-text-muted">· {replacements.length}</span>
            </SectionTitle>
            <Card padded={false}>
              <ul className="divide-y divide-border">
                {replacements.map((replacement) => (
                  <ReplacementRow
                    key={replacement.id}
                    replacement={replacement}
                    delivery={replacement.deliveryId ? deliveries.get(replacement.deliveryId) : undefined}
                    showDate={false}
                    onSelect={() => setEditing(replacement)}
                  />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}

      {months.length > 0 ? (
        <>
          <SectionTitle>Consommation par mois</SectionTitle>
          <Card padded={false}>
            <ul className="divide-y divide-border">
              {months.map(({ month, count }) => (
                <li key={month} className="flex min-h-12 items-center justify-between px-4">
                  <span className="text-[0.9375rem] text-text">{capitalize(formatMonth(month))}</span>
                  <span className="num font-bold text-text">{plural(count, 'bonbonne')}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {adding ? <ReplacementSheet today={today} onClose={() => setAdding(false)} /> : null}
      {editing ? <ReplacementSheet today={today} replacement={editing} onClose={() => setEditing(null)} /> : null}
    </AppShell>
  )
}

/** Ajout d'un oubli ou modification d'un remplacement en attente (date et heure de Maurice). */
function ReplacementSheet({ today, replacement, onClose }: { today: IsoDate; replacement?: EffectiveReplacement; onClose: () => void }) {
  const commit = useCommit()
  const id = useId()
  const [date, setDate] = useState(replacement ? mauritiusDateOf(replacement.replacedAt) : today)
  const [time, setTime] = useState(() => mauritiusTimeOf(replacement?.replacedAt ?? new Date().toISOString()))
  const [note, setNote] = useState(replacement?.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    const ok = await commit(
      () => (replacement ? editReplacementOp(replacement, { date, time, note }) : addReplacementOp({ date, time, note })),
      { message: replacement ? 'Remplacement modifié' : 'Remplacement ajouté' },
    )
    if (ok) onClose()
  }

  async function remove() {
    if (!replacement) return
    const ok = await commit(() => deleteReplacementOp(replacement), { message: 'Remplacement supprimé' })
    if (ok) onClose()
  }

  return (
    <>
      <Sheet
        open={!confirmDelete}
        onClose={onClose}
        title={replacement ? 'Modifier le remplacement' : 'Remplacement oublié'}
        subtitle="Date et heure à Maurice"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            {replacement ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} aria-hidden="true" />
                Supprimer
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={() => void save()}>
              Enregistrer
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor={`${id}-date`}>
              <input
                id={`${id}-date`}
                type="date"
                className={inputClass}
                value={date}
                max={today}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Heure" htmlFor={`${id}-time`}>
              <input id={`${id}-time`} type="time" className={inputClass} value={time} onChange={(event) => setTime(event.target.value)} required />
            </Field>
          </div>
          <Field label="Note (facultative)" htmlFor={`${id}-note`}>
            <textarea id={`${id}-note`} className={textareaClass} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirmDelete}
        title="Supprimer ce remplacement ?"
        confirmLabel="Supprimer"
        tone="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      >
        <p>Il ne sera plus compté pour le Foyer 1 à la prochaine livraison.</p>
      </ConfirmSheet>
    </>
  )
}
