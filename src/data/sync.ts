// Moteur de synchronisation (repris de Presence, sans temps réel) :
// - les écritures partent dans la file (outbox), sont appliquées tout de
//   suite à l'affichage, puis rejouées vers Supabase dans l'ordre, sans
//   fusion : un remplacement part toujours avant la livraison qui le
//   rattache ;
// - une opération refusée par le serveur bloque la file (Réessayer /
//   Abandonner) au lieu d'être sautée ;
// - après chaque vidage de la file, les tables sont relues entièrement
//   (elles sont petites). Envoi et relecture ne se chevauchent jamais :
//   un instantané périmé ne peut pas écraser une écriture confirmée.
import type { AppDB, OutboxEntry } from './db.ts'
import { confirmOp, enqueue, replaceMirror } from './mirror.ts'
import { type Op, describeOp } from './ops.ts'
import { type Remote, SyncError, asSyncError } from './remote.ts'

export interface SyncState {
  /** Le serveur est joignable (d'après le navigateur et le dernier échange). */
  online: boolean
  syncing: boolean
  lastSyncAt: string | null
  /** Dernière erreur passagère (réseau, serveur) : nouvelle tentative prévue. */
  lastError: string | null
  /** La session doit être renouvelée (reconnexion nécessaire). */
  authRequired: boolean
  /** Opération refusée définitivement : la file attend Réessayer ou Abandonner. */
  blocked: { entryId: number; label: string; message: string } | null
}

export interface SyncOptions {
  /** Tente de renouveler la session ; `true` si elle est de nouveau valide. */
  refreshAuth?: () => Promise<boolean>
  /** Une opération vient d'être refusée par le serveur. */
  onBlocked?: (blocked: NonNullable<SyncState['blocked']>) => void
  /** Délais de nouvelle tentative (ms) après une erreur réseau ou serveur. */
  retryDelays?: number[]
  /** Relecture au retour au premier plan si la dernière date de plus de… (ms). */
  refreshOnFocusMs?: number
}

type DrainOutcome = 'empty' | 'blocked' | 'error'

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export class SyncEngine {
  private state: SyncState
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private rerun = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryIndex = 0
  private detachWindow: (() => void) | null = null
  private started = false
  /** Incrémenté à chaque arrêt : un démarrage interrompu (StrictMode) n'attache rien. */
  private generation = 0
  private readonly db: AppDB
  private readonly remote: Remote
  private readonly options: SyncOptions
  private blockedListener: SyncOptions['onBlocked'] | null = null

  constructor(db: AppDB, remote: Remote, options: SyncOptions = {}) {
    this.db = db
    this.remote = remote
    this.options = options
    this.state = { online: browserOnline(), syncing: false, lastSyncAt: null, lastError: null, authRequired: false, blocked: null }
  }

  /** Écouteur des refus (toast), remplaçable sans recréer le moteur. */
  setBlockedListener(listener: SyncOptions['onBlocked'] | null): void {
    this.blockedListener = listener
  }

  // ---- état observable (useSyncExternalStore) ----

  getState = (): SyncState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<SyncState>): void {
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof SyncState] === value)) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  // ---- cycle de vie ----

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const generation = ++this.generation
    const lastSync = await this.db.meta.get('lastPullAt')
    if (!this.started || generation !== this.generation) return
    this.setState({ lastSyncAt: typeof lastSync?.value === 'string' ? lastSync.value : null })

    if (typeof window !== 'undefined') {
      const onOnline = () => {
        this.setState({ online: true })
        this.retryIndex = 0
        void this.sync()
      }
      const onOffline = () => this.setState({ online: false })
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return
        const last = this.state.lastSyncAt ? Date.parse(this.state.lastSyncAt) : 0
        if (Date.now() - last > (this.options.refreshOnFocusMs ?? 60_000) || this.state.lastError) void this.sync()
      }
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
      this.detachWindow = () => {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
    await this.sync()
  }

  stop(): void {
    this.started = false
    this.generation += 1
    this.detachWindow?.()
    this.detachWindow = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  // ---- écritures ----

  /** Enregistre une écriture : visible immédiatement, envoyée dès que possible. */
  async commit(op: Op): Promise<void> {
    await enqueue(this.db, op)
    void this.sync()
  }

  /** Relance l'opération bloquée (après correction ou en cas de refus passager). */
  async retryBlocked(): Promise<void> {
    const blocked = this.state.blocked
    if (!blocked) return
    await this.db.outbox.update(blocked.entryId, { failed: false })
    this.setState({ blocked: null })
    await this.sync()
  }

  /** Abandonne l'opération bloquée ; l'affichage revient à l'état du serveur. */
  async discardBlocked(): Promise<void> {
    const blocked = this.state.blocked
    if (!blocked) return
    await this.db.outbox.delete(blocked.entryId)
    this.setState({ blocked: null })
    await this.sync()
  }

  // ---- boucle : vider la file, puis relire ----

  /**
   * Vide la file puis relit les tables. Une seule exécution à la fois ; un
   * appel pendant une exécution relance un passage complet à la fin de
   * celle-ci, et la promesse renvoyée couvre ce passage.
   */
  sync(): Promise<void> {
    if (!browserOnline()) {
      this.setState({ online: false })
      return this.running ?? Promise.resolve()
    }
    this.rerun = true
    this.running ??= this.withLock(async () => {
      while (this.rerun) {
        this.rerun = false
        this.setState({ syncing: true })
        const outcome = await this.drain()
        if (outcome !== 'error') await this.pull()
      }
    }).finally(() => {
      this.running = null
      this.setState({ syncing: false })
    })
    return this.running
  }

  /** Attend la fin de l'exécution en cours. */
  async whenIdle(): Promise<void> {
    await this.running
  }

  /** Verrou inter-onglets : un seul onglet envoie et relit à la fois. */
  private async withLock(task: () => Promise<void>): Promise<void> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) return task()
    await locks.request('eaupartagee-sync', task)
  }

  private async drain(): Promise<DrainOutcome> {
    let refreshedAuth = false
    for (;;) {
      const entry: OutboxEntry | undefined = await this.db.outbox.orderBy('id').first()
      if (!entry?.id) {
        if (this.state.blocked) this.setState({ blocked: null })
        return 'empty'
      }
      if (entry.failed) {
        this.block(entry, entry.lastError ?? 'Refusé par le serveur', false)
        return 'blocked'
      }
      try {
        const result = await this.remote.execute(entry.op)
        await confirmOp(this.db, entry, result)
        this.markReachable()
      } catch (raw) {
        const error = asSyncError(raw)
        await this.db.outbox.update(entry.id, {
          attempts: entry.attempts + 1,
          lastError: error.message.slice(0, 300),
          failed: error.kind === 'rejected',
        })
        if (error.kind === 'rejected') {
          this.markReachable()
          this.block(entry, error.message, true)
          return 'blocked'
        }
        if (error.kind === 'auth' && !refreshedAuth && (await this.options.refreshAuth?.())) {
          refreshedAuth = true
          continue
        }
        this.handleError(error)
        return 'error'
      }
    }
  }

  private block(entry: OutboxEntry, message: string, notify: boolean): void {
    const blocked = { entryId: entry.id!, label: describeOp(entry.op), message }
    const same = this.state.blocked?.entryId === blocked.entryId && this.state.blocked.message === message
    if (!same) this.setState({ blocked })
    if (notify) (this.blockedListener ?? this.options.onBlocked)?.(blocked)
  }

  private async pull(): Promise<void> {
    try {
      const snapshot = await this.remote.fetchAll()
      const at = new Date().toISOString()
      await replaceMirror(this.db, snapshot, at)
      this.markReachable()
      this.setState({ lastSyncAt: at })
    } catch (raw) {
      const error = asSyncError(raw)
      if (error.kind === 'auth' && (await this.options.refreshAuth?.())) {
        this.rerun = true
        return
      }
      this.handleError(error)
    }
  }

  // ---- état réseau ----

  private markReachable(): void {
    this.retryIndex = 0
    this.setState({ online: true, lastError: null, authRequired: false })
  }

  private handleError(error: SyncError): void {
    if (error.kind === 'auth') {
      this.setState({ authRequired: true, lastError: 'Session expirée : reconnectez-vous.' })
      return
    }
    this.setState({
      online: error.kind === 'network' ? false : this.state.online,
      lastError: error.kind === 'network' ? 'Serveur injoignable : nouvel essai bientôt.' : error.message.slice(0, 160),
    })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer) return
    const delays = this.options.retryDelays ?? [2_000, 5_000, 15_000, 30_000, 60_000]
    const delay = delays[Math.min(this.retryIndex, delays.length - 1)]!
    this.retryIndex += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.sync()
    }, delay)
  }
}
