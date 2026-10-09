import { Camera, Download, Eye, FileUp, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { CommandError, attachDocumentOp, detachDocumentOp } from '../data/commands.ts'
import { ACCEPTED_TYPES, prepareDocument } from '../data/documents.ts'
import type { DocumentTarget, LocalDocument, PendingMark } from '../data/ops.ts'
import { signedDocumentUrl } from '../data/remote.ts'
import { supabase } from '../data/supabase.ts'
import { useToast } from '../ui/Toaster.tsx'
import { Button } from '../ui/controls.tsx'
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx'
import { useCommit } from './useCommit.ts'

export type DocumentOwner = { id: string; documentPath: string | null; month?: string } & LocalDocument & PendingMark

/** Boutons cachés : appareil photo (capture) ou fichier (image ou PDF). */
export function DocumentPicker({ onFile, busy, label = 'Ajouter le document' }: { onFile: (file: File) => void; busy?: boolean; label?: string }) {
  const camera = useRef<HTMLInputElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (chosen) onFile(chosen)
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => camera.current?.click()}>
        <Camera size={18} aria-hidden="true" />
        Prendre une photo
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => file.current?.click()}>
        <FileUp size={18} aria-hidden="true" />
        {label}
      </Button>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} aria-hidden="true" tabIndex={-1} />
      <input ref={file} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={pick} aria-hidden="true" tabIndex={-1} />
    </div>
  )
}

/** Ouvre une URL dans un nouvel onglet ; la fenêtre est ouverte au clic (bloqueurs de fenêtres). */
async function openInNewTab(resolve: () => Promise<string>): Promise<void> {
  const popup = window.open('', '_blank')
  try {
    const url = await resolve()
    if (popup) {
      popup.opener = null
      popup.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (error) {
    popup?.close()
    throw error
  }
}

/** Ouvre ou télécharge un document : Blob local s'il est en attente d'envoi, sinon URL signée (en ligne). */
export function useDocumentOpener(): (owner: DocumentOwner, download: boolean, name: string) => Promise<void> {
  const toast = useToast()
  return useCallback(
    async (owner, download, name) => {
      const local = owner.localDocument
      try {
        if (local) {
          const url = URL.createObjectURL(local.blob)
          window.open(url, '_blank', 'noopener')
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
          return
        }
        const path = owner.documentPath
        if (!path || !supabase) return
        if (!navigator.onLine) {
          toast({ tone: 'error', message: 'Consultation impossible hors ligne : le document est sur le serveur.' })
          return
        }
        const extension = /\.([a-z]+)$/.exec(path)?.[1] ?? 'pdf'
        const client = supabase
        await openInNewTab(() => signedDocumentUrl(client, path, download ? `${name}.${extension}` : undefined))
      } catch {
        toast({ tone: 'error', message: 'Document indisponible pour le moment. Réessayez.' })
      }
    },
    [toast],
  )
}

/** Consultation, téléchargement, ajout, remplacement et retrait d'un document (bon ou SOA). */
export function DocumentPanel({
  target,
  owner,
  downloadName,
  emptyLabel,
}: {
  target: DocumentTarget
  owner: DocumentOwner
  /** Nom du fichier téléchargé, sans extension. */
  downloadName: string
  emptyLabel: string
}) {
  const commit = useCommit()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  async function attach(file: File) {
    setBusy(true)
    try {
      const prepared = await prepareDocument(file)
      await commit(() => attachDocumentOp(target, owner as Parameters<typeof attachDocumentOp>[1], prepared), {
        message: owner.documentPath ? 'Document remplacé' : 'Document ajouté',
      })
    } catch (error) {
      toast({ tone: 'error', message: error instanceof CommandError ? error.message : 'Ce fichier n’a pas pu être lu.' })
    } finally {
      setBusy(false)
    }
  }

  const openDocument = useDocumentOpener()
  const open = (download: boolean) => openDocument(owner, download, downloadName)

  if (!owner.documentPath) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[0.9375rem] text-text-muted">{emptyLabel}</p>
        <DocumentPicker onFile={(file) => void attach(file)} busy={busy} label="Image ou PDF" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {owner.localDocument ? (
        <p className="text-sm font-bold text-warning-ink">Document en attente d’envoi : il partira au retour du réseau.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void open(false)}>
          <Eye size={18} aria-hidden="true" />
          Voir
        </Button>
        <Button variant="secondary" onClick={() => void open(true)}>
          <Download size={18} aria-hidden="true" />
          Télécharger
        </Button>
      </div>
      <details className="rounded-2xl bg-surface-2 px-4 py-2">
        <summary className="min-h-11 content-center text-[0.9375rem] font-bold text-text">Remplacer ou retirer le document</summary>
        <div className="flex flex-col gap-3 pb-2 pt-1">
          <DocumentPicker onFile={(file) => void attach(file)} busy={busy} label="Nouveau fichier" />
          <Button variant="danger" className="self-start" disabled={busy} onClick={() => setConfirmRemove(true)}>
            <Trash2 size={18} aria-hidden="true" />
            Retirer le document
          </Button>
        </div>
      </details>
      <ConfirmSheet
        open={confirmRemove}
        title="Retirer le document ?"
        confirmLabel="Retirer"
        tone="danger"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false)
          void commit(() => detachDocumentOp(target, owner), { message: 'Document retiré' })
        }}
      >
        <p>Le fichier sera supprimé du stockage.</p>
      </ConfirmSheet>
      {busy ? (
        <p className="inline-flex items-center gap-2 text-sm text-text-muted">
          <RefreshCw size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Préparation du document…
        </p>
      ) : null}
    </div>
  )
}
