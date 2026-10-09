import { ChevronRight, CloudUpload, FileText, MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { CommandError, attachDocumentOp, deleteSoaOp, saveSoaOp, soaFigures } from '../data/commands.ts'
import { prepareDocument } from '../data/documents.ts'
import type { AppData } from '../data/mirror.ts'
import type { EffectiveDelivery, EffectiveSoa, Op } from '../data/ops.ts'
import { type MonthStatus, type MonthSummary, bottlesF2, deliveryF2Cents, f2Adjustment, summarizeMonth, summarizeMonths } from '../domain/calculations.ts'
import { addMonths, monthOf } from '../domain/dates.ts'
import { capitalize, centsToInput, formatDateShort, formatMonth, formatRs, parseRsToCents, plural } from '../domain/format.ts'
import type { IsoDate, IsoMonth, VarianceTreatment } from '../domain/types.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { navigate } from '../lib/router.ts'
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { useToast } from '../ui/Toaster.tsx'
import { Button, Card, Field, Notice, SectionTitle, Select, inputClass, textareaClass } from '../ui/controls.tsx'
import { DocumentPanel, DocumentPicker } from './DocumentPanel.tsx'
import { RecapSheet } from './RecapSheet.tsx'
import { FigureRow, SplitTags } from './shared.tsx'
import { useCommit } from './useCommit.ts'

const STATUS: Record<MonthStatus, { label: string; className: string }> = {
  no_soa: { label: 'SOA à saisir', className: 'bg-surface-2 text-text-muted' },
  reconciled: { label: 'Rapproché', className: 'bg-success-soft text-success-ink' },
  to_treat: { label: 'Écart à traiter', className: 'bg-warning-soft text-warning-ink' },
  treated: { label: 'Écart traité', className: 'bg-success-soft text-success-ink' },
  stale: { label: 'Livraisons modifiées', className: 'bg-warning-soft text-warning-ink' },
}

export function MonthStatusBadge({ summary, current }: { summary: MonthSummary; current: boolean }) {
  const status = current && summary.status === 'no_soa' ? { label: 'Mois en cours', className: 'bg-primary-soft text-primary' } : STATUS[summary.status]
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-bold ${status.className}`}>{status.label}</span>
}

const TREATMENTS: { value: VarianceTreatment; label: string; hint: string }[] = [
  { value: 'impute_to_f2', label: 'Imputer au Foyer 2', hint: 'Tout l’écart s’ajoute à son solde.' },
  { value: 'split_50_50', label: 'Partager 50/50', hint: 'Moitié chacun, arrondie vers zéro ; le reste au Foyer 1.' },
  { value: 'impute_to_f1', label: 'Imputer au Foyer 1', hint: 'Le solde du Foyer 2 ne change pas.' },
  { value: 'pending', label: 'Laisser en attente', hint: 'À trancher plus tard ; rien n’est imputé pour l’instant.' },
]

export function MonthsScreen({ data, today }: { data: AppData; today: IsoDate }) {
  const [soaFor, setSoaFor] = useState<{ month: IsoMonth; soa: EffectiveSoa | null } | null>(null)
  const [detail, setDetail] = useState<IsoMonth | null>(null)
  const [recapFor, setRecapFor] = useState<IsoMonth | null>(null)
  const currentMonth = monthOf(today)
  const months = summarizeMonths(data.deliveries, data.soas)
  const toReconcile = months.filter((m) => m.month < currentMonth && m.status !== 'reconciled' && m.status !== 'treated').length
  const detailSummary = detail ? summarizeMonth(detail, data.deliveries, data.soas.find((s) => s.month === detail) ?? null) : null

  const hero = (
    <div className="pt-1">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">Rapprochement des SOA</p>
      <p className="mt-1 font-display text-[2.5rem] font-extrabold leading-tight">
        <span className="num">{toReconcile}</span> <span className="text-xl">mois à rapprocher</span>
      </p>
      <p className="text-[0.9375rem] text-header-ink-2">Total SOA comparé au total attendu d’après les livraisons.</p>
    </div>
  )

  return (
    <AppShell title="Mois" hero={hero}>
      <Button variant="primary" size="lg" className="w-full" onClick={() => setSoaFor({ month: addMonths(currentMonth, -1), soa: null })}>
        <Plus size={20} aria-hidden="true" />
        Saisir un SOA
      </Button>

      <SectionTitle>Historique</SectionTitle>
      {months.length === 0 ? (
        <Card>
          <p className="text-[0.9375rem] text-text-muted">Aucune livraison ni SOA pour l’instant.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {months.map((summary) => (
            <li key={summary.month}>
              <button
                type="button"
                onClick={() => setDetail(summary.month)}
                className="flex w-full flex-col gap-2 rounded-3xl border border-border bg-surface p-4 text-left shadow-card hover:bg-surface-2"
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="font-display text-lg font-bold text-text">{capitalize(formatMonth(summary.month))}</span>
                  <MonthStatusBadge summary={summary} current={summary.month === currentMonth} />
                </span>
                <span className="text-[0.9375rem] text-text">
                  {plural(summary.deliveries.length, 'livraison')} · {plural(summary.bottlesTotal, 'bonbonne')}
                </span>
                <SplitTags f1={summary.bottlesF1} f2={summary.bottlesF2} />
                <dl className="w-full">
                  <FigureRow label="Total attendu" value={formatRs(summary.expectedCents)} />
                  {summary.soa ? <FigureRow label="Total SOA" value={formatRs(summary.soa.totalBilledCents)} /> : null}
                  {summary.varianceCents !== null && summary.varianceCents !== 0 ? (
                    <FigureRow label="Écart" value={<span className="text-warning-ink">{formatRs(summary.varianceCents, { signed: true })}</span>} />
                  ) : null}
                </dl>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-primary">
                  Détail du mois <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detailSummary ? (
        <MonthDetail
          summary={detailSummary}
          current={detailSummary.month === currentMonth}
          onClose={() => setDetail(null)}
          onEditSoa={() => setSoaFor({ month: detailSummary.month, soa: (detailSummary.soa as EffectiveSoa | null) ?? null })}
          onRecap={() => setRecapFor(detailSummary.month)}
        />
      ) : null}
      {recapFor ? <RecapSheet data={data} today={today} initialMonth={recapFor} onClose={() => setRecapFor(null)} /> : null}
      {soaFor ? <SoaSheet data={data} today={today} initialMonth={soaFor.month} existing={soaFor.soa} onClose={() => setSoaFor(null)} /> : null}
    </AppShell>
  )
}

function MonthDetail({
  summary,
  current,
  onClose,
  onEditSoa,
  onRecap,
}: {
  summary: MonthSummary<EffectiveDelivery>
  current: boolean
  onClose: () => void
  onEditSoa: () => void
  onRecap: () => void
}) {
  const soa = summary.soa as EffectiveSoa | null
  return (
    <Sheet open onClose={onClose} title={capitalize(formatMonth(summary.month))} subtitle={<MonthStatusBadge summary={summary} current={current} />}>
      <div className="flex flex-col gap-5">
        <dl className="rounded-2xl border border-border px-4 py-2">
          <FigureRow label="Bonbonnes livrées" value={summary.bottlesTotal} />
          <FigureRow label="Foyer 1" value={`${summary.bottlesF1} · ${formatRs(summary.f1Cents)}`} />
          <FigureRow label="Foyer 2" value={`${summary.bottlesF2} · ${formatRs(summary.f2Cents)}`} />
          <FigureRow label="Total attendu" value={formatRs(summary.expectedCents)} strong />
          <FigureRow label="Total SOA" value={soa ? formatRs(soa.totalBilledCents) : '—'} />
          {summary.varianceCents !== null ? (
            <FigureRow
              label="Écart"
              value={<span className={summary.varianceCents !== 0 ? 'text-warning-ink' : 'text-success-ink'}>{formatRs(summary.varianceCents, { signed: true })}</span>}
            />
          ) : null}
          {summary.f2AdjustmentCents !== 0 ? <FigureRow label="Ajustement Foyer 2" value={formatRs(summary.f2AdjustmentCents, { signed: true })} /> : null}
        </dl>

        {summary.status === 'stale' ? (
          <Notice tone="warning">
            Les livraisons du mois ont changé depuis le rapprochement (écart actuel : {formatRs(summary.currentVarianceCents ?? 0, { signed: true })}).
            Refaites le rapprochement.
          </Notice>
        ) : null}
        {summary.status === 'to_treat' ? <Notice tone="warning">Écart en attente : choisissez son traitement.</Notice> : null}

        <div className="flex flex-col gap-2">
          <Button variant={soa ? 'secondary' : 'primary'} onClick={onEditSoa}>
            {soa ? 'Modifier le SOA et l’écart' : 'Saisir le SOA du mois'}
          </Button>
          <Button variant="secondary" onClick={onRecap}>
            <MessageSquareText size={18} aria-hidden="true" />
            Message récapitulatif du mois
          </Button>
        </div>

        {soa ? (
          <section>
            <h3 className="mb-2 font-display text-base font-bold">Document du SOA</h3>
            <DocumentPanel target="soa" owner={soa} downloadName={`soa-${soa.month}`} emptyLabel="Aucun document joint." />
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 font-display text-base font-bold">Livraisons du mois</h3>
          {summary.deliveries.length === 0 ? (
            <p className="text-[0.9375rem] text-text-muted">Aucune livraison ce mois-ci.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {summary.deliveries.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/livraisons?id=${d.id}`)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-text">{capitalize(formatDateShort(d.deliveryDate))}</span>
                      <span className="text-sm text-text-muted">
                        {d.bottlesTotal} au total · Foyer 1 : {d.bottlesF1} · Foyer 2 : {bottlesF2(d)}
                      </span>
                    </span>
                    {d.documentPath ? <FileText size={18} className="text-text-muted" aria-label="Bon joint" /> : null}
                    {d.pending ? <CloudUpload size={18} className="text-warning-ink" aria-label="En attente de synchronisation" /> : null}
                    <span className="num font-bold text-foyer-2-ink">{formatRs(deliveryF2Cents(d))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  )
}

/** Mois proposés : ceux des livraisons et des SOA, plus les 12 derniers mois. */
function monthChoices(data: AppData, today: IsoDate): IsoMonth[] {
  const current = monthOf(today)
  const months = new Set<IsoMonth>([...data.deliveries.map((d) => monthOf(d.deliveryDate)), ...data.soas.map((s) => s.month)])
  for (let i = 0; i <= 12; i++) months.add(addMonths(current, -i))
  return [...months].filter((m) => m <= current).sort().reverse()
}

function SoaSheet({
  data,
  today,
  initialMonth,
  existing,
  onClose,
}: {
  data: AppData
  today: IsoDate
  initialMonth: IsoMonth
  existing: EffectiveSoa | null
  onClose: () => void
}) {
  const commit = useCommit()
  const toast = useToast()
  const id = useId()
  const [month, setMonth] = useState(existing?.month ?? initialMonth)
  const soaOfMonth = existing ?? data.soas.find((s) => s.month === month) ?? null
  const [total, setTotal] = useState(soaOfMonth ? centsToInput(soaOfMonth.totalBilledCents) : '')
  const [treatment, setTreatment] = useState<VarianceTreatment | null>(soaOfMonth && soaOfMonth.varianceCents !== 0 ? soaOfMonth.varianceTreatment : null)
  const [note, setNote] = useState(soaOfMonth?.note ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const totalCents = parseRsToCents(total)
  const figures = totalCents === null ? null : soaFigures(data, month, totalCents)
  const variance = figures?.varianceCents ?? null
  const needsTreatment = variance !== null && variance !== 0
  const canSave = totalCents !== null && (!needsTreatment || treatment !== null)

  function chooseMonth(next: IsoMonth) {
    setMonth(next)
    const other = data.soas.find((s) => s.month === next)
    if (other) {
      setTotal(centsToInput(other.totalBilledCents))
      setTreatment(other.varianceCents !== 0 ? other.varianceTreatment : null)
      setNote(other.note ?? '')
    }
  }

  async function save() {
    if (totalCents === null) return
    setBusy(true)
    try {
      const document = file ? await prepareDocument(file) : null
      const target = data.soas.find((s) => s.month === month) ?? null
      const ok = await commit(
        () => {
          const op = saveSoaOp(
            data,
            { month, totalBilledCents: totalCents, varianceTreatment: treatment ?? 'pending', note },
            { existing: target, allowPending: treatment === 'pending' },
          )
          const ops: Op[] = [op]
          if (document && op.kind === 'soa.save') {
            ops.push(attachDocumentOp('soa', { id: op.soa.id, month: op.soa.month, documentPath: target?.documentPath ?? null }, document))
          }
          return ops
        },
        { message: 'SOA enregistré' },
      )
      if (ok) onClose()
    } catch (error) {
      toast({ tone: 'error', message: error instanceof CommandError ? error.message : 'Le document n’a pas pu être lu.' })
    } finally {
      setBusy(false)
    }
  }

  const target = data.soas.find((s) => s.month === month) ?? null

  return (
    <>
      <Sheet
        open={!confirmDelete}
        onClose={onClose}
        title={target ? 'Modifier le SOA' : 'Saisir un SOA'}
        subtitle="Relevé mensuel envoyé par Odezil"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            {target ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} aria-hidden="true" />
                Supprimer
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" disabled={!canSave || busy} onClick={() => void save()}>
              Enregistrer le SOA
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <Field label="Mois" htmlFor={`${id}-month`}>
            <Select id={`${id}-month`} value={month} onChange={(event) => chooseMonth(event.target.value)} disabled={Boolean(existing)}>
              {monthChoices(data, today).map((m) => (
                <option key={m} value={m}>
                  {capitalize(formatMonth(m))}
                  {data.soas.some((s) => s.month === m) ? ' (SOA saisi)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Total du SOA (Rs)" htmlFor={`${id}-total`} hint={total && totalCents === null ? 'Montant invalide.' : undefined}>
            <input
              id={`${id}-total`}
              inputMode="decimal"
              autoComplete="off"
              className={`${inputClass} num`}
              placeholder="0,00"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
            />
          </Field>

          <dl className="rounded-2xl border border-border px-4 py-2">
            <FigureRow label="Total attendu (livraisons du mois)" value={formatRs(figures?.expectedCents ?? soaFigures(data, month, 0).expectedCents)} />
            <FigureRow
              label="Écart"
              value={
                variance === null ? (
                  '—'
                ) : (
                  <span className={variance !== 0 ? 'text-warning-ink' : 'text-success-ink'}>{formatRs(variance, { signed: true })}</span>
                )
              }
              strong
            />
          </dl>

          {needsTreatment ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[0.9375rem] font-bold text-text">Traitement de l’écart</legend>
              {TREATMENTS.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 ${
                    treatment === option.value ? 'border-primary bg-primary-soft' : 'border-border bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-treatment`}
                    className="mt-1 size-5 accent-primary"
                    checked={treatment === option.value}
                    onChange={() => setTreatment(option.value)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-text">{option.label}</span>
                    <span className="block text-sm text-text-muted">
                      {option.hint}
                      {variance !== null && option.value !== 'pending' && option.value !== 'impute_to_f1'
                        ? ` Foyer 2 : ${formatRs(f2Adjustment(variance, option.value), { signed: true })}.`
                        : ''}
                    </span>
                  </span>
                </label>
              ))}
              {treatment === null ? <p className="text-sm font-bold text-warning-ink">Choisissez un traitement pour valider.</p> : null}
            </fieldset>
          ) : null}

          {!target ? (
            <div className="flex flex-col gap-2">
              <span className="text-[0.9375rem] font-bold text-text">Document du SOA (facultatif)</span>
              {file ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9375rem] text-text">{file.name || 'Photo'}</span>
                  <Button variant="ghost" onClick={() => setFile(null)}>
                    Retirer
                  </Button>
                </div>
              ) : (
                <DocumentPicker onFile={setFile} label="Image ou PDF" />
              )}
            </div>
          ) : null}

          <Field label="Note (facultative)" htmlFor={`${id}-note`}>
            <textarea id={`${id}-note`} className={textareaClass} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirmDelete}
        title="Supprimer ce SOA ?"
        confirmLabel="Supprimer"
        tone="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!target) return
          setConfirmDelete(false)
          void commit(() => deleteSoaOp(target), { message: 'SOA supprimé' }).then((ok) => ok && onClose())
        }}
      >
        <p>L’écart et son traitement seront supprimés{target?.documentPath ? ', ainsi que le document joint' : ''}.</p>
      </ConfirmSheet>
    </>
  )
}
