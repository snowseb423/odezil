// Base IndexedDB locale : miroir des tables Supabase + file d'écritures.
// L'interface lit uniquement ici, ce qui la rend utilisable hors ligne.
import Dexie, { type EntityTable } from 'dexie'
import type { Delivery, Price, Replacement, Repayment, SoaStatement } from '../domain/types.ts'
import type { Op } from './ops.ts'

/** Lien de consultation actif du Foyer 2 (le token n'est jamais conservé). */
export interface ShareLink {
  id: string
  createdAt: string
}

export interface OutboxEntry {
  id?: number
  op: Op
  createdAt: string
  attempts: number
  lastError: string | null
  /** Refus définitif du serveur : la file est bloquée sur cette opération. */
  failed: boolean
}

export interface MetaRow {
  key: string
  value: unknown
}

export class AppDB extends Dexie {
  prices!: EntityTable<Price, 'id'>
  replacements!: EntityTable<Replacement, 'id'>
  deliveries!: EntityTable<Delivery, 'id'>
  soas!: EntityTable<SoaStatement, 'id'>
  repayments!: EntityTable<Repayment, 'id'>
  shareLinks!: EntityTable<ShareLink, 'id'>
  outbox!: EntityTable<OutboxEntry, 'id'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name = 'eaupartagee') {
    super(name)
    this.version(1).stores({
      prices: 'id',
      replacements: 'id, replacedAt',
      deliveries: 'id, deliveryDate',
      soas: 'id, month',
      repayments: 'id',
      shareLinks: 'id',
      outbox: '++id',
      meta: 'key',
    })
  }
}

export const MIRROR_TABLES = ['prices', 'replacements', 'deliveries', 'soas', 'repayments', 'shareLinks'] as const
export type MirrorTable = (typeof MIRROR_TABLES)[number]
