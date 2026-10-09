import { CloudUpload, FileText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { CommandError, attachDocumentOp, deleteDeliveryOp, deliveryPreview, saveDeliveryOp, updateDeliveryNoteOp } from '../data/commands.ts'
import { prepareDocument } from '../data/documents.ts'
import type { AppData } from '../data/mirror.ts'
import type { EffectiveDelivery, Op } from '../data/ops.ts'
import { bottlesF2, deliveryF1Cents, deliveryF2Cents, deliveryTotalCents, pendingReplacements } from '../domain/calculations.ts'
import { mauritiusDateOf } from '../domain/dates.ts'
import { capitalize, formatDate, formatDateLong, formatDateShort, formatRs, formatTime, plural } from '../domain/format.ts'
import type { IsoDate } from '../domain/types.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { navigate } from '../lib/router.ts'
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { useToast } from '../ui/Toaster.tsx'
import { Button, Card, Field, SectionTitle, Stepper, inputClass, textareaClass } from '../ui/controls.tsx'
import { DocumentPanel, DocumentPicker } from './DocumentPanel.tsx'
import { AllocationPreview, FigureRow, SplitTags } from './shared.tsx'
import { useCommit } from './useCommit.ts'

export function DeliveriesScreen({ data, today, params }: { data: AppData; today: IsoDate; params: URLSearchParams }) {
  const requested = params.get('id')
  const [creating, setCreating] = useState(() => params.get('nouvelle') === '1')
  const [selectedId, setSelectedId] = useState<string | null>(requested)
  const selected = data.deliveries.find((d) => d.id === selectedId) ?? null
  const pending = pendingReplacements(data.replacements).length

  // Les paramètres d'URL (depuis l'accueil ou le journal) ne servent qu'une fois.
  useEffect(() => {
    if (window.location.search) navigate('/livraisons', { replace: true })
  }, [])

  const hero = (
    <div className="pt-1">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">En attente de livraison</p>
      <p className="mt-1 font-display text-[2.5rem] font-extrabold leading-tight">
        <span className="num">{pending}</span> <span className="text-xl">{pending >= 2 ? 'remplacements' : 'remplacement'} du Foyer 1</span>
      </p>
      <p className="text-[0.9375rem] text-header-ink-2">
        {data.deliveries[0] ? `Dernière livraison : ${formatDate(data.deliveries[0].deliveryDate)}` : 'Aucune livraison enregistrée'}
      </p>
    </div>
  )

  return (
    <AppShell title="Livraisons" hero={hero}>
      <Button variant="primary" size="lg" className="w-full" onClick={() => setCreating(true)}>
        <Plus size={20} aria-hidden="true" />
        Nouvelle livraison
      </Button>

      <SectionTitle>Livraisons enregistrées</SectionTitle>
      {data.deliveries.length === 0 ? (
        <Card>
          <p className="text-[0.9375rem] text-text-muted">
            À chaque passage du livreur, saisissez la date et le nombre total de bonbonnes remplacées : la répartition est calculée seule.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.deliveries.map((delivery) => (
            <li key={delivery.id}>
              <button
                type="button"
                onClick={() => setSelectedId(delivery.id)}
                className="flex w-full flex-col gap-2 rounded-3xl border border-border bg-surface p-4 text-left shadow-card hover:bg-surface-2"
              >
                <span className="flex w-full items-start justify-between gap-3">
                  <span className="font-display text-lg font-bold text-text">{capitalize(formatDateShort(delivery.deliveryDate))}</span>
                  <span className="flex items-center gap-2 text-text-muted">
                    {delivery.documentPath ? <FileText size={18} aria-label="Bon de livraison joint" /> : null}
                    {delivery.pending ? <CloudUpload size={18} className="text-warning-ink" aria-label="En attente de synchronisation" /> : null}
                  </span>
                </span>
                <span className="text-[0.9375rem] text-text">{plural(delivery.bottlesTotal, 'bonbonne')} remplacées par Odezil</span>
                <span className="flex w-full flex-wrap items-center justify-between gap-2">
                  <SplitTags f1={delivery.bottlesF1} f2={bottlesF2(delivery)} />
                  <span className="num font-bold text-foyer-2-ink">{formatRs(deliveryF2Cents(delivery))}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? <DeliveryForm data={data} today={today} onClose={() => setCreating(false)} /> : null}
      {selected ? <DeliveryDetail data={data} today={today} delivery={selected} onClose={() => setSelectedId(null)} /> : null}
    </AppShell>
  )
}

/** Création, ou modification de la date et du total (recalcul de la répartition). */
function DeliveryForm({ data, today, existing, onClose }: { data: AppData; today: IsoDate; existing?: EffectiveDelivery; onClose: () => void }) {
  const commit = useCommit()
  const toast = useToast()
  const id = useId()
  const candidates = pendingReplacements(data.replacements).length
  const [date, setDate] = useState(existing?.deliveryDate ?? today)
  // Tant que le compteur n'a pas été touché, il propose le nombre de remplacements en attente.
  const [chosenTotal, setTotal] = useState<number | null>(existing?.bottlesTotal ?? null)
  const total = chosenTotal ?? Math.max(1, candidates)
  const [note, setNote] = useState(existing?.note ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const draft = { deliveryDate: date, bottlesTotal: total, note }
  const preview = deliveryPreview(data, draft, existing)

  async function save() {
    setBusy(true)
    try {
      const document = file ? await prepareDocument(file) : null
      const ok = await commit(
        () => {
          const { op } = saveDeliveryOp(data, draft, { existing, confirmed: true })
          const ops: Op[] = [op]
          if (document && op.kind === 'delivery.save') ops.push(attachDocumentOp('delivery', { id: op.delivery.id, documentPath: null }, document))
          return ops
        },
        { message: existing ? 'Répartition recalculée' : 'Livraison enregistrée' },
      )
      if (ok) onClose()
    } catch (error) {
      toast({ tone: 'error', message: error instanceof CommandError ? error.message : 'Le document n’a pas pu être lu.' })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  function submit() {
    if (!preview) {
      toast({ tone: 'error', message: 'Aucun prix unitaire n’est en vigueur à cette date.' })
      return
    }
    if (preview.allocation.requiresConfirmation || (existing && preview.changed)) setConfirming(true)
    else void save()
  }

  return (
    <>
      <Sheet
        open={!confirming}
        onClose={onClose}
        title={existing ? 'Modifier la livraison' : 'Nouvelle livraison'}
        subtitle={existing ? 'La répartition sera recalculée.' : 'Bon de livraison du livreur Odezil'}
        footer={
          <Button variant="primary" size="lg" className="w-full" disabled={busy || !preview} onClick={submit}>
            {existing ? 'Recalculer et enregistrer' : 'Enregistrer la livraison'}
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          <Field label="Date de livraison" htmlFor={`${id}-date`}>
            <input id={`${id}-date`} type="date" className={inputClass} value={date} max={today} onChange={(event) => setDate(event.target.value)} required />
          </Field>
          <div className="flex flex-col items-start gap-2">
            <span className="text-[0.9375rem] font-bold text-text" id={`${id}-total`}>
              Bonbonnes remplacées par Odezil (total des deux foyers)
            </span>
            <Stepper value={total} onChange={setTotal} min={1} max={99} label="Total des bonbonnes" size="lg" />
          </div>
          {preview ? <AllocationPreview preview={preview} /> : <p className="text-danger-ink">Aucun prix unitaire n’est en vigueur à cette date.</p>}
          {!existing ? (
            <div className="flex flex-col gap-2">
              <span className="text-[0.9375rem] font-bold text-text">Bon de livraison (facultatif)</span>
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
        open={confirming}
        title={existing ? 'Recalculer la répartition ?' : 'Confirmer la livraison'}
        confirmLabel={existing ? 'Recalculer' : 'Confirmer'}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void save()}
      >
        {preview?.allocation.requiresConfirmation ? (
          <p className="font-bold">Aucun remplacement enregistré pour le Foyer 1 : toutes les bonbonnes seront attribuées au Foyer 2.</p>
        ) : null}
        {preview?.before ? (
          <p>
            Montant du Foyer 2 : {formatRs(preview.before.f2Cents)} → <strong>{formatRs(preview.after.f2Cents)}</strong>
          </p>
        ) : null}
        {preview ? <p>Foyer 1 : {preview.after.bottlesF1} · Foyer 2 : {preview.after.bottlesF2}</p> : null}
      </ConfirmSheet>
    </>
  )
}

function DeliveryDetail({ data, today, delivery, onClose }: { data: AppData; today: IsoDate; delivery: EffectiveDelivery; onClose: () => void }) {
  const commit = useCommit()
  const toast = useToast()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'recalculate' | null>(null)
  const [note, setNote] = useState(delivery.note ?? '')
  const attached = data.replacements.filter((r) => r.deliveryId === delivery.id).sort((a, b) => Date.parse(a.replacedAt) - Date.parse(b.replacedAt))
  const recalculation = deliveryPreview(data, { deliveryDate: delivery.deliveryDate, bottlesTotal: delivery.bottlesTotal, note: delivery.note }, delivery)

  if (editing) return <DeliveryForm data={data} today={today} existing={delivery} onClose={() => setEditing(false)} />

  return (
    <>
      <Sheet
        open={confirm === null}
        onClose={onClose}
        title={`Livraison du ${formatDate(delivery.deliveryDate)}`}
        subtitle={capitalize(formatDateLong(delivery.deliveryDate))}
      >
        <div className="flex flex-col gap-5">
          <dl className="rounded-2xl border border-border px-4 py-2">
            <FigureRow label="Total remplacé par Odezil" value={plural(delivery.bottlesTotal, 'bonbonne')} />
            <FigureRow label="Foyer 1 (enregistrés)" value={`${delivery.bottlesF1} · ${formatRs(deliveryF1Cents(delivery))}`} />
            <FigureRow label="Foyer 2" value={`${bottlesF2(delivery)} · ${formatRs(deliveryF2Cents(delivery))}`} strong />
            <FigureRow label="Prix appliqué (figé)" value={formatRs(delivery.unitPriceCentsApplied)} />
            <FigureRow label="Total de la livraison" value={formatRs(deliveryTotalCents(delivery))} />
          </dl>

          <section>
            <h3 className="mb-2 font-display text-base font-bold">Remplacements rattachés ({attached.length})</h3>
            {attached.length ? (
              <ul className="flex flex-wrap gap-2">
                {attached.map((r) => (
                  <li key={r.id} className="rounded-full bg-foyer-1-soft px-3 py-1 text-sm font-bold text-foyer-1-ink">
                    {formatDateShort(mauritiusDateOf(r.replacedAt))} · {formatTime(r.replacedAt)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.9375rem] text-text-muted">Aucun : toutes les bonbonnes sont au Foyer 2.</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-display text-base font-bold">Bon de livraison</h3>
            <DocumentPanel target="delivery" owner={delivery} downloadName={`bon-livraison-${delivery.deliveryDate}`} emptyLabel="Aucun bon joint." />
          </section>

          <section>
            <Field label="Note" htmlFor={`${id}-note`}>
              <textarea id={`${id}-note`} className={textareaClass} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            {note !== (delivery.note ?? '') ? (
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => void commit(() => updateDeliveryNoteOp(data, delivery, note), { message: 'Note enregistrée' })}
              >
                Enregistrer la note
              </Button>
            ) : null}
          </section>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={18} aria-hidden="true" />
              Modifier la date ou le total
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (recalculation && !recalculation.changed) toast({ message: 'La répartition est déjà à jour.' })
                else setConfirm('recalculate')
              }}
            >
              <RefreshCw size={18} aria-hidden="true" />
              Recalculer la répartition
            </Button>
            <Button variant="danger" onClick={() => setConfirm('delete')}>
              <Trash2 size={18} aria-hidden="true" />
              Supprimer la livraison
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirm === 'recalculate'}
        title="Recalculer la répartition ?"
        confirmLabel="Recalculer"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          void commit(
            () => saveDeliveryOp(data, { deliveryDate: delivery.deliveryDate, bottlesTotal: delivery.bottlesTotal, note: delivery.note }, { existing: delivery, confirmed: true }).op,
            { message: 'Répartition recalculée' },
          )
        }}
      >
        {recalculation ? <AllocationPreview preview={recalculation} /> : <p>Aucun prix en vigueur à cette date.</p>}
      </ConfirmSheet>

      <ConfirmSheet
        open={confirm === 'delete'}
        title="Supprimer cette livraison ?"
        confirmLabel="Supprimer"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          void commit(() => deleteDeliveryOp(delivery), { message: 'Livraison supprimée' }).then((ok) => ok && onClose())
        }}
      >
        <p>
          {attached.length
            ? `${plural(attached.length, 'remplacement')} du Foyer 1 ${attached.length >= 2 ? 'repasseront' : 'repassera'} en attente.`
            : 'Aucun remplacement n’y est rattaché.'}
          {delivery.documentPath ? ' Le bon de livraison sera supprimé.' : ''}
        </p>
      </ConfirmSheet>
    </>
  )
}
