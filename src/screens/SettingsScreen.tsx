import { CheckCircle2, Copy, Download, Link2, LogOut, RefreshCw, Share, Share2, SquarePlus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { deletePriceOp, savePriceOp } from '../data/commands.ts'
import { useEngine, useSyncState } from '../data/DataProvider.tsx'
import type { AppData } from '../data/mirror.ts'
import type { EffectivePrice } from '../data/ops.ts'
import { revokeShareLinks, rotateShareLink } from '../data/share.ts'
import { supabase } from '../data/supabase.ts'
import { priceAt } from '../domain/calculations.ts'
import { formatDate, formatRs, formatTimestamp, parseRsToCents, plural } from '../domain/format.ts'
import type { IsoDate } from '../domain/types.ts'
import { env } from '../env.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { promptInstall, useInstallState } from '../pwa/install.ts'
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { useToast } from '../ui/Toaster.tsx'
import { Button, Card, Field, Notice, SectionTitle, inputClass } from '../ui/controls.tsx'
import { useCommit } from './useCommit.ts'

export function SettingsScreen({ data, today }: { data: AppData; today: IsoDate }) {
  return (
    <AppShell title="Réglages">
      <SectionTitle>Prix d’une bonbonne</SectionTitle>
      <PriceSection data={data} today={today} />
      <SectionTitle>Lien du Foyer 2</SectionTitle>
      <ShareSection data={data} />
      <SectionTitle>Synchronisation</SectionTitle>
      <SyncSection pending={data.outbox.length} />
      <SectionTitle>Installer l’app</SectionTitle>
      <InstallSection />
      <SectionTitle>Compte</SectionTitle>
      <AccountSection pending={data.outbox.length} />
      <p className="mt-6 text-sm text-text-muted">EauPartagée · version {env.appVersion}</p>
    </AppShell>
  )
}

function PriceSection({ data, today }: { data: AppData; today: IsoDate }) {
  const commit = useCommit()
  const id = useId()
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState(today)
  const [removing, setRemoving] = useState<EffectivePrice | null>(null)
  const current = priceAt(today, data.prices)
  const cents = parseRsToCents(amount)
  const first = data.prices[0]?.id

  return (
    <Card className="flex flex-col gap-4">
      <p className="text-[0.9375rem] text-text">
        Prix actuel : <strong className="num">{current === null ? '—' : formatRs(current)}</strong> TTC. Un nouveau prix s’applique aux livraisons
        datées à partir de sa date d’effet ; les livraisons déjà enregistrées gardent leur prix.
      </p>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {[...data.prices].reverse().map((price) => (
          <li key={price.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 text-[0.9375rem] text-text">
              {price.effectiveFrom <= '2000-01-01' ? 'Prix initial' : `Depuis le ${formatDate(price.effectiveFrom)}`}
            </span>
            <span className="num font-bold text-text">{formatRs(price.unitPriceCents)}</span>
            {price.id !== first ? (
              <button
                type="button"
                className="grid size-11 place-items-center rounded-full text-danger-ink hover:bg-danger-soft"
                aria-label={`Supprimer le prix du ${formatDate(price.effectiveFrom)}`}
                onClick={() => setRemoving(price)}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (cents === null) return
          void commit(() => savePriceOp(data, { unitPriceCents: cents, effectiveFrom: from }), { message: `Nouveau prix : ${formatRs(cents)}` }).then(
            (ok) => ok && setAmount(''),
          )
        }}
      >
        <Field label="Nouveau prix (Rs)" htmlFor={`${id}-amount`}>
          <input id={`${id}-amount`} inputMode="decimal" placeholder="240,00" className={`${inputClass} num`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="À partir du" htmlFor={`${id}-from`}>
          <input id={`${id}-from`} type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" className="col-span-2" disabled={cents === null || cents <= 0}>
          Ajouter ce prix
        </Button>
      </form>
      <ConfirmSheet
        open={removing !== null}
        title="Supprimer ce prix ?"
        confirmLabel="Supprimer"
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const price = removing
          setRemoving(null)
          if (price) void commit(() => deletePriceOp(data, price), { message: 'Prix supprimé' })
        }}
      >
        <p>Les livraisons déjà enregistrées gardent le prix qui leur a été appliqué.</p>
      </ConfirmSheet>
    </Card>
  )
}

function ShareSection({ data }: { data: AppData }) {
  const engine = useEngine()
  const toast = useToast()
  const sync = useSyncState()
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null)
  const active = data.shareLink

  async function run(task: () => Promise<void>) {
    if (!supabase) return
    if (!navigator.onLine) {
      toast({ tone: 'error', message: 'Connexion internet nécessaire pour gérer le lien.' })
      return
    }
    setBusy(true)
    try {
      await task()
      await engine.sync()
    } catch (error) {
      toast({ tone: 'error', message: `Opération impossible : ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <p className="text-[0.9375rem] text-text">
        Le Foyer 2 consulte son solde, ses livraisons et ses remboursements, en lecture seule, sans compte. Il ne voit aucune donnée du Foyer 1.
      </p>
      <p className="flex items-center gap-2 text-[0.9375rem] font-bold text-text">
        <Link2 size={18} aria-hidden="true" />
        {active ? `Lien actif depuis le ${formatTimestamp(active.createdAt)}` : 'Aucun lien actif'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !sync.online} onClick={() => (active ? setConfirm('rotate') : void run(async () => setCreated((await rotateShareLink(supabase!, window.location.origin)).url)))}>
          {active ? 'Générer un nouveau lien' : 'Générer le lien'}
        </Button>
        {active ? (
          <Button variant="danger" disabled={busy || !sync.online} onClick={() => setConfirm('revoke')}>
            Révoquer le lien
          </Button>
        ) : null}
      </div>
      {!sync.online ? <p className="text-sm text-text-muted">Connexion internet nécessaire.</p> : null}

      <ConfirmSheet
        open={confirm === 'rotate'}
        title="Générer un nouveau lien ?"
        confirmLabel="Générer"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          void run(async () => setCreated((await rotateShareLink(supabase!, window.location.origin)).url))
        }}
      >
        <p>L’ancien lien cessera immédiatement de fonctionner.</p>
      </ConfirmSheet>
      <ConfirmSheet
        open={confirm === 'revoke'}
        title="Révoquer le lien ?"
        confirmLabel="Révoquer"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          void run(async () => {
            await revokeShareLinks(supabase!)
            toast({ message: 'Lien révoqué' })
          })
        }}
      >
        <p>Le Foyer 2 ne pourra plus consulter la page tant qu’un nouveau lien n’aura pas été généré.</p>
      </ConfirmSheet>
      {created ? <CreatedLinkSheet url={created} onClose={() => setCreated(null)} /> : null}
    </Card>
  )
}

/** Le lien complet n'est affiché qu'une seule fois. */
function CreatedLinkSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const toast = useToast()
  const id = useId()
  const canShare = typeof navigator.share === 'function'
  return (
    <Sheet
      open
      onClose={onClose}
      title="Nouveau lien du Foyer 2"
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          {canShare ? (
            <Button variant="secondary" onClick={() => void navigator.share({ url }).catch(() => undefined)}>
              <Share2 size={18} aria-hidden="true" />
              Partager
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .then(() => toast({ message: 'Lien copié' }))
                .catch(() => toast({ tone: 'error', message: 'Copie impossible : sélectionnez le lien.' }))
            }
          >
            <Copy size={18} aria-hidden="true" />
            Copier
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Notice tone="warning">Ce lien ne sera plus jamais affiché : copiez-le maintenant et envoyez-le au Foyer 2.</Notice>
        <Field label="Lien complet" htmlFor={`${id}-url`}>
          <textarea id={`${id}-url`} readOnly className={`${inputClass} min-h-24 break-all py-3`} value={url} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      </div>
    </Sheet>
  )
}

function SyncSection({ pending }: { pending: number }) {
  const sync = useSyncState()
  const engine = useEngine()
  const [busy, setBusy] = useState(false)
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-[0.9375rem] text-text">
        {sync.lastSyncAt ? `Dernière synchronisation : ${formatTimestamp(sync.lastSyncAt)}.` : 'Pas encore synchronisé.'}
        {pending ? ` ${plural(pending, 'modification')} en attente.` : ' Tout est envoyé.'}
      </p>
      {sync.blocked ? <Notice tone="danger">Envoi bloqué : {sync.blocked.label}. Touchez le badge de synchronisation pour réessayer.</Notice> : null}
      <Button
        className="self-start"
        disabled={busy || !sync.online}
        onClick={async () => {
          setBusy(true)
          try {
            await engine.sync()
          } finally {
            setBusy(false)
          }
        }}
      >
        <RefreshCw size={18} className={busy ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
        Synchroniser maintenant
      </Button>
    </Card>
  )
}

/** Aide iOS : Safari n'expose pas beforeinstallprompt. */
export function IosInstallSteps() {
  return (
    <ol className="flex flex-col gap-2 text-[0.9375rem] text-text">
      <li className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">1</span>
        <span>
          Dans Safari, touchez <Share size={17} className="inline align-[-3px]" aria-label="Partager" /> <strong>Partager</strong>
        </span>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">2</span>
        <span>
          Choisissez <SquarePlus size={17} className="inline align-[-3px]" aria-hidden="true" /> <strong>Sur l’écran d’accueil</strong>
        </span>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">3</span>
        <span>
          Touchez <strong>Ajouter</strong> : l’app s’ouvre ensuite en plein écran
        </span>
      </li>
    </ol>
  )
}

function InstallSection() {
  const install = useInstallState()
  return (
    <Card>
      {install.standalone || install.installed ? (
        <p className="flex items-center gap-2 text-[0.9375rem] text-success-ink">
          <CheckCircle2 size={18} aria-hidden="true" /> L’app est installée sur cet appareil.
        </p>
      ) : install.canPrompt ? (
        <Button variant="primary" onClick={() => void promptInstall()}>
          <Download size={18} aria-hidden="true" />
          Installer l’app
        </Button>
      ) : install.ios ? (
        <IosInstallSteps />
      ) : (
        <p className="text-[0.9375rem] text-text-muted">Ouvrez le menu du navigateur puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p>
      )}
    </Card>
  )
}

function AccountSection({ pending }: { pending: number }) {
  const { state, signOut } = useAuth()
  const [confirm, setConfirm] = useState(false)
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-[0.9375rem] text-text">Connecté : {state.status === 'signedIn' ? <strong className="break-all">{state.user.email}</strong> : '—'}</p>
      <Button variant="danger" className="self-start" onClick={() => setConfirm(true)}>
        <LogOut size={18} aria-hidden="true" />
        Se déconnecter
      </Button>
      <ConfirmSheet
        open={confirm}
        title="Se déconnecter ?"
        confirmLabel="Se déconnecter"
        tone="danger"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void signOut()
        }}
      >
        <p>Les données enregistrées sur cet appareil seront effacées (elles restent sur le serveur).</p>
        {pending ? (
          <p className="font-bold text-danger-ink">
            Attention : {plural(pending, 'modification')} pas encore {pending >= 2 ? 'envoyées seront perdues' : 'envoyée sera perdue'}.
          </p>
        ) : null}
      </ConfirmSheet>
    </Card>
  )
}
