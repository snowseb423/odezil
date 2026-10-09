// Accès à Supabase : exécution des opérations de la file et lecture
// complète des tables. Le moteur de synchronisation ne dépend que de
// l'interface `Remote`, ce qui permet de le tester sans réseau.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Delivery, Price, Replacement, Repayment, SoaStatement } from '../domain/types.ts'
import type { ShareLink } from './db.ts'
import type { Op } from './ops.ts'
import {
  type Json,
  deliveryPayload,
  priceColumns,
  repaymentColumns,
  replacementColumns,
  soaColumns,
  toDelivery,
  toPrice,
  toReplacement,
  toRepayment,
  toShareLink,
  toSoa,
} from './rows.ts'

export const DOCUMENTS_BUCKET = 'documents'

export type SyncErrorKind =
  /** Pas de réseau : on réessaiera. */
  | 'network'
  /** Erreur passagère du serveur (5xx, 429…) : on réessaiera. */
  | 'server'
  /** Session expirée ou absente. */
  | 'auth'
  /** Refus définitif (droits, contrainte) : la file s'arrête sur l'opération. */
  | 'rejected'

export class SyncError extends Error {
  readonly kind: SyncErrorKind
  readonly status: number

  constructor(message: string, kind: SyncErrorKind, status = 0) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
    this.status = status
  }
}

export function classifyStatus(status: number): SyncErrorKind {
  if (!status) return 'network'
  if (status === 401) return 'auth'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'server'
  return 'rejected'
}

export function asSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error
  return new SyncError(error instanceof Error ? error.message : String(error), 'network')
}

/** Résultat d'une opération : la livraison telle que figée par la base. */
export interface OpResult {
  delivery?: Delivery
}

export interface Snapshot {
  prices: Price[]
  replacements: Replacement[]
  deliveries: Delivery[]
  soas: SoaStatement[]
  repayments: Repayment[]
  shareLinks: ShareLink[]
}

export interface Remote {
  execute(op: Op): Promise<OpResult>
  fetchAll(): Promise<Snapshot>
}

interface Result {
  data: unknown
  error: { message: string } | null
  status: number
}

function check<T extends Result>(result: T): T {
  if (result.error) {
    throw new SyncError(result.error.message || `HTTP ${result.status}`, classifyStatus(result.status), result.status)
  }
  return result
}

/** Erreur de Storage (StorageApiError porte un statut HTTP ; sinon : réseau). */
function storageError(error: { message: string; status?: unknown; statusCode?: unknown }): SyncError {
  const status = Number(error.status ?? error.statusCode ?? 0)
  const code = Number.isFinite(status) ? status : 0
  return new SyncError(error.message || `HTTP ${code}`, classifyStatus(code), code)
}

const PAGE = 1000

export function createSupabaseRemote(client: SupabaseClient): Remote {
  const bucket = () => client.storage.from(DOCUMENTS_BUCKET)

  async function removeDocument(path: string | null): Promise<void> {
    if (!path) return
    // Supprimer un fichier déjà absent n'est pas une erreur (rejeu).
    const { error } = await bucket().remove([path])
    if (error) throw storageError(error)
  }

  async function setDocumentPath(target: 'delivery' | 'soa', id: string, path: string | null): Promise<void> {
    const table = target === 'delivery' ? 'deliveries' : 'soa_statements'
    check(await client.from(table).update({ document_path: path }).eq('id', id))
  }

  /** Lecture complète d'une table, par pages (limite de 1 000 lignes de l'API). */
  async function fetchRows(table: string, columns: string, onlyActive = false): Promise<Json[]> {
    const rows: Json[] = []
    for (let from = 0; ; from += PAGE) {
      let query = client.from(table).select(columns).order('id').range(from, from + PAGE - 1)
      if (onlyActive) query = query.is('revoked_at', null)
      const { data } = check(await query)
      const page = (data ?? []) as unknown as Json[]
      rows.push(...page)
      if (page.length < PAGE) return rows
    }
  }

  return {
    async execute(op) {
      switch (op.kind) {
        case 'replacement.upsert':
          check(await client.from('replacements').upsert(replacementColumns(op.replacement), { onConflict: 'id' }))
          return {}
        case 'replacement.delete':
          check(await client.from('replacements').delete().eq('id', op.id))
          return {}
        case 'delivery.save': {
          const { data } = check(
            await client.rpc('save_delivery', { p_delivery: deliveryPayload(op.delivery), p_replacement_ids: op.replacementIds }),
          )
          return { delivery: toDelivery(data as Json) }
        }
        case 'delivery.delete':
          check(await client.from('deliveries').delete().eq('id', op.id))
          await removeDocument(op.documentPath)
          return {}
        case 'document.attach': {
          const { error } = await bucket().upload(op.path, op.blob, { upsert: true, contentType: op.contentType, cacheControl: '0' })
          if (error) throw storageError(error)
          await setDocumentPath(op.target, op.targetId, op.path)
          if (op.previousPath && op.previousPath !== op.path) await removeDocument(op.previousPath)
          return {}
        }
        case 'document.detach':
          await setDocumentPath(op.target, op.targetId, null)
          await removeDocument(op.path)
          return {}
        case 'soa.save':
          check(await client.from('soa_statements').upsert(soaColumns(op.soa), { onConflict: 'id' }))
          return {}
        case 'soa.delete':
          check(await client.from('soa_statements').delete().eq('id', op.id))
          await removeDocument(op.documentPath)
          return {}
        case 'repayment.save':
          check(await client.from('repayments').upsert(repaymentColumns(op.repayment), { onConflict: 'id' }))
          return {}
        case 'repayment.delete':
          check(await client.from('repayments').delete().eq('id', op.id))
          return {}
        case 'price.save':
          check(await client.from('price_settings').upsert(priceColumns(op.price), { onConflict: 'id' }))
          return {}
        case 'price.delete':
          check(await client.from('price_settings').delete().eq('id', op.id))
          return {}
      }
    },

    async fetchAll() {
      const [prices, replacements, deliveries, soas, repayments, shareLinks] = await Promise.all([
        fetchRows('price_settings', 'id, unit_price_cents, effective_from'),
        fetchRows('replacements', 'id, replaced_at, note, delivery_id'),
        fetchRows('deliveries', 'id, delivery_date, bottles_total, bottles_f1, unit_price_cents_applied, document_path, note'),
        fetchRows('soa_statements', 'id, month, total_billed_cents, variance_cents, variance_treatment, document_path, note'),
        fetchRows('repayments', 'id, repayment_date, amount_cents, note'),
        fetchRows('share_links', 'id, created_at', true),
      ])
      return {
        prices: prices.map(toPrice),
        replacements: replacements.map(toReplacement),
        deliveries: deliveries.map(toDelivery),
        soas: soas.map(toSoa),
        repayments: repayments.map(toRepayment),
        shareLinks: shareLinks.map(toShareLink),
      }
    },
  }
}

/**
 * URL signée de courte durée (60 s) pour consulter ou télécharger un
 * document. En ligne uniquement : le service worker ne met rien en cache.
 */
export async function signedDocumentUrl(client: SupabaseClient, path: string, download?: string): Promise<string> {
  const { data, error } = await client.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60, download ? { download } : undefined)
  if (error || !data?.signedUrl) throw storageError(error ?? { message: 'URL indisponible' })
  return data.signedUrl
}
