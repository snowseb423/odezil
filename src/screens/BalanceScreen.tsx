import { CloudUpload, MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { deleteRepaymentOp, saveRepaymentOp } from '../data/commands.ts'
import type { AppData } from '../data/mirror.ts'
import type { EffectiveRepayment } from '../data/ops.ts'
import { balanceF2 } from '../domain/calculations.ts'
import { capitalize, centsToInput, formatDateLong, formatDateShort, formatRs, parseRsToCents } from '../domain/format.ts'
import type { IsoDate } from '../domain/types.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { Button, Card, Field, SectionTitle, inputClass, textareaClass } from '../ui/controls.tsx'
import { RecapSheet } from './RecapSheet.tsx'
import { FigureRow } from './shared.tsx'
import { useCommit } from './useCommit.ts'

export function BalanceScreen({ data, today }: { data: AppData; today: IsoDate }) {
  const [editing, setEditing] = useState<EffectiveRepayment | 'new' | null>(null)
  const [recap, setRecap] = useState(false)
  const balance = balanceF2(data)
  const advance = balance.balanceCents < 0

  const hero = (
    <div className="pt-1">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">{advance ? 'Avance du Foyer 2' : 'Solde à régler par le Foyer 2'}</p>
      <p className="num mt-1 font-display text-[3.25rem] font-extrabold leading-none tracking-tight" data-testid="balance">
        {formatRs(Math.abs(balance.balanceCents))}
      </p>
      <p className="mt-2 text-[0.9375rem] text-header-ink-2">
        {balance.balanceCents === 0 ? 'Tout est réglé.' : advance ? 'Remboursements supérieurs aux bonbonnes dues.' : 'Parts des livraisons, ajustements et remboursements compris.'}
      </p>
    </div>
  )

  return (
    <AppShell title="Solde" hero={hero}>
      <div className="grid grid-cols-1 gap-3">
        <Button variant="primary" size="lg" onClick={() => setEditing('new')}>
          <Plus size={20} aria-hidden="true" />
          Enregistrer un remboursement
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setRecap(true)}>
          <MessageSquareText size={20} aria-hidden="true" />
          Message récapitulatif
        </Button>
      </div>

      <SectionTitle>Détail du solde</SectionTitle>
      <Card>
        <dl>
          <FigureRow label="Parts Foyer 2 des livraisons" value={formatRs(balance.chargesCents)} />
          <FigureRow label="Ajustements (écarts SOA)" value={formatRs(balance.adjustmentsCents, { signed: true })} />
          <FigureRow label="Remboursements reçus" value={`−${formatRs(balance.repaymentsCents)}`} />
          <div className="mt-1 border-t border-border pt-1">
            <FigureRow label={advance ? 'Avance' : 'Reste à régler'} value={formatRs(Math.abs(balance.balanceCents))} strong />
          </div>
        </dl>
      </Card>

      <SectionTitle>Remboursements reçus</SectionTitle>
      {data.repayments.length === 0 ? (
        <Card>
          <p className="text-[0.9375rem] text-text-muted">Aucun remboursement enregistré. Le paiement se fait hors de l’app : notez-le ici dès réception.</p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-border">
            {data.repayments.map((repayment) => (
              <li key={repayment.id}>
                <button
                  type="button"
                  onClick={() => setEditing(repayment)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-text">{capitalize(formatDateShort(repayment.repaymentDate))}</span>
                    {repayment.note ? <span className="block break-words text-sm text-text-muted">{repayment.note}</span> : null}
                  </span>
                  {repayment.pending ? <CloudUpload size={18} className="text-warning-ink" aria-label="En attente de synchronisation" /> : null}
                  <span className="num font-bold text-success-ink">{formatRs(repayment.amountCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing ? <RepaymentSheet today={today} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {recap ? <RecapSheet data={data} today={today} onClose={() => setRecap(false)} /> : null}
    </AppShell>
  )
}

function RepaymentSheet({ today, existing, onClose }: { today: IsoDate; existing: EffectiveRepayment | null; onClose: () => void }) {
  const commit = useCommit()
  const id = useId()
  const [date, setDate] = useState(existing?.repaymentDate ?? today)
  const [amount, setAmount] = useState(existing ? centsToInput(existing.amountCents) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cents = parseRsToCents(amount)

  async function save() {
    if (cents === null) return
    const ok = await commit(() => saveRepaymentOp({ repaymentDate: date, amountCents: cents, note }, existing), {
      message: existing ? 'Remboursement modifié' : `Remboursement de ${formatRs(cents)} enregistré`,
    })
    if (ok) onClose()
  }

  return (
    <>
      <Sheet
        open={!confirmDelete}
        onClose={onClose}
        title={existing ? 'Modifier le remboursement' : 'Remboursement reçu'}
        subtitle="Partiel ou groupé : le solde se met à jour."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            {existing ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} aria-hidden="true" />
                Supprimer
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" disabled={cents === null || cents <= 0} onClick={() => void save()}>
              Enregistrer
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Date de réception" htmlFor={`${id}-date`}>
            <input id={`${id}-date`} type="date" className={inputClass} value={date} max={today} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Montant (Rs)" htmlFor={`${id}-amount`} hint={amount && cents === null ? 'Montant invalide.' : undefined}>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className={`${inputClass} num`}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Note (facultative)" htmlFor={`${id}-note`}>
            <textarea id={`${id}-note`} className={textareaClass} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirmDelete}
        title="Supprimer ce remboursement ?"
        confirmLabel="Supprimer"
        tone="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!existing) return
          setConfirmDelete(false)
          void commit(() => deleteRepaymentOp(existing), { message: 'Remboursement supprimé' }).then((ok) => ok && onClose())
        }}
      >
        {existing ? (
          <p>
            {formatRs(existing.amountCents)} reçus le {formatDateLong(existing.repaymentDate)} : le solde du Foyer 2 augmentera d’autant.
          </p>
        ) : null}
      </ConfirmSheet>
    </>
  )
}
