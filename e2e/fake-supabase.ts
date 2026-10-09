// Faux Supabase pour les tests de bout en bout (repris de Presence) : Auth
// (session, PKCE, Google), REST (PostgREST), RPC et Storage, en mémoire,
// avec les mêmes règles que la base (save_delivery atomique, prix figé,
// verrou, get_shared_view limitée au Foyer 2).
import { createHash } from 'node:crypto'
import type { BrowserContext, Page, Route } from '@playwright/test'

type Row = Record<string, unknown>

export const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', email: 'admin@example.com' }
export const ORIGIN = 'http://supabase.e2e'

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function accessToken(email: string, id: string): string {
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp: 4_102_444_800, amr: [{ method: 'oauth', timestamp: 1 }] }),
    'e2e-signature',
  ].join('.')
}

function session(email = ADMIN.email, id = ADMIN.id) {
  return {
    access_token: accessToken(email, id),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_102_444_800,
    refresh_token: 'e2e-refresh',
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: '2026-09-01T00:00:00Z',
      app_metadata: { provider: 'google' },
      user_metadata: {},
      created_at: '2026-09-01T00:00:00Z',
    },
  }
}

const mauritiusDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10)

export class FakeSupabase {
  prices: Row[] = [{ id: '00000000-0000-4000-8000-000000024000', unit_price_cents: 24_000, effective_from: '2000-01-01' }]
  replacements = new Map<string, Row>()
  deliveries = new Map<string, Row>()
  soas = new Map<string, Row>()
  repayments = new Map<string, Row>()
  shareLinks: Row[] = []
  storage = new Map<string, Buffer>()
  /** Requêtes d'écriture reçues (méthode, chemin), dans l'ordre. */
  writes: string[] = []
  rpcCalls: { fn: string; args: Row }[] = []
  google = true
  /** Compte choisi sur la page Google. */
  googleEmail = ADMIN.email
  /** Résultat de is_admin() pour l'utilisateur connecté. */
  admin = true
  /** Le serveur ne répond plus (coupure réseau simulée). */
  down = false
  authorizeUrls: URL[] = []

  /** Session enregistrée avant le chargement : l'app démarre connectée et vérifiée. */
  async signIn(context: BrowserContext): Promise<void> {
    await context.addInitScript(
      ({ stored, user }) => {
        localStorage.setItem('eaupartagee-auth', JSON.stringify(stored))
        localStorage.setItem('eaupartagee:verified-admin', JSON.stringify(user))
      },
      { stored: session(), user: ADMIN },
    )
  }

  seedShareLink(token: string): void {
    this.shareLinks.push({ id: 'e2e-link', token_hash: createHash('sha256').update(token).digest('hex'), created_at: '2026-10-01T08:00:00Z', revoked_at: null })
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${ORIGIN}/**`, (route) => this.handle(route))
  }

  private async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })

    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        },
      })
    }
    if (this.down) return route.abort('internetdisconnected')

    const path = url.pathname
    if (path.startsWith('/auth/v1/')) return this.auth(route, url, json)
    if (path.startsWith('/storage/v1/')) return this.storageRoute(route, url, json)
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length)
      const args = (request.postDataJSON() ?? {}) as Row
      this.rpcCalls.push({ fn, args })
      try {
        return json(this.rpc(fn, args))
      } catch (error) {
        return json({ message: (error as Error).message, code: '23514' }, 400)
      }
    }
    if (path.startsWith('/rest/v1/')) return this.rest(route, url, json)
    return json({ message: `non simulé : ${path}` }, 404)
  }

  private auth(route: Route, url: URL, json: (body: unknown, status?: number) => Promise<void>) {
    const path = url.pathname
    if (path.endsWith('/settings')) return json({ external: { email: true, google: this.google } })
    if (path.endsWith('/authorize')) {
      this.authorizeUrls.push(url)
      const back = new URL(url.searchParams.get('redirect_to') ?? '')
      if (this.googleEmail === ADMIN.email) back.search = new URLSearchParams({ code: 'e2e-code' }).toString()
      else back.search = new URLSearchParams({ error: 'server_error', error_description: 'Database error saving new user' }).toString()
      return route.fulfill({ status: 302, headers: { location: back.toString() } })
    }
    if (path.endsWith('/token')) return json(session())
    if (path.endsWith('/user')) return json(session().user)
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    if (path.endsWith('/otp')) return json({})
    if (path.endsWith('/verify')) return json(session())
    return json({ message: 'non simulé' }, 404)
  }

  private storageRoute(route: Route, url: URL, json: (body: unknown, status?: number) => Promise<void>) {
    const request = route.request()
    const objectPath = url.pathname.replace(/^\/storage\/v1\/object\/(sign\/)?documents\//, '')
    if (url.pathname.startsWith('/storage/v1/object/sign/documents/') && request.method() === 'POST') {
      return json({ signedURL: `/object/public-e2e/${objectPath}?token=e2e` })
    }
    if (url.pathname.startsWith('/storage/v1/object/public-e2e/')) {
      const key = url.pathname.replace('/storage/v1/object/public-e2e/', '')
      const body = this.storage.get(key)
      if (!body) return json({ message: 'introuvable' }, 404)
      return route.fulfill({ status: 200, body, contentType: key.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' })
    }
    if (url.pathname === '/storage/v1/object/documents' && request.method() === 'DELETE') {
      const { prefixes } = request.postDataJSON() as { prefixes: string[] }
      for (const prefix of prefixes) this.storage.delete(prefix)
      this.writes.push(`DELETE storage ${prefixes.join(',')}`)
      return json(prefixes.map((name) => ({ name })))
    }
    if (url.pathname.startsWith('/storage/v1/object/documents/') && (request.method() === 'POST' || request.method() === 'PUT')) {
      this.storage.set(objectPath, request.postDataBuffer() ?? Buffer.alloc(0))
      this.writes.push(`UPLOAD ${objectPath}`)
      return json({ Key: `documents/${objectPath}`, Id: 'e2e' })
    }
    return json({ message: 'non simulé' }, 404)
  }

  private tableRows(table: string): Row[] {
    switch (table) {
      case 'price_settings':
        return this.prices
      case 'replacements':
        return [...this.replacements.values()]
      case 'deliveries':
        return [...this.deliveries.values()]
      case 'soa_statements':
        return [...this.soas.values()]
      case 'repayments':
        return [...this.repayments.values()]
      case 'share_links':
        return this.shareLinks.filter((l) => l.revoked_at === null).map(({ id, created_at, revoked_at }) => ({ id, created_at, revoked_at }))
      default:
        return []
    }
  }

  private tableMap(table: string): Map<string, Row> | null {
    switch (table) {
      case 'replacements':
        return this.replacements
      case 'deliveries':
        return this.deliveries
      case 'soa_statements':
        return this.soas
      case 'repayments':
        return this.repayments
      default:
        return null
    }
  }

  private rest(route: Route, url: URL, json: (body: unknown, status?: number) => Promise<void>) {
    const request = route.request()
    const table = url.pathname.replace('/rest/v1/', '')
    const idFilter = url.searchParams.get('id')?.replace(/^eq\./, '') ?? null
    if (request.method() === 'GET') return json(this.tableRows(table))
    this.writes.push(`${request.method()} ${table}${idFilter ? ` ${idFilter}` : ''}`)

    if (table === 'price_settings') {
      if (request.method() === 'POST') {
        const rows = [request.postDataJSON()].flat() as Row[]
        for (const row of rows) this.prices = [...this.prices.filter((p) => p.id !== row.id), row]
      }
      if (request.method() === 'DELETE') this.prices = this.prices.filter((p) => p.id !== idFilter)
      return json([])
    }
    const map = this.tableMap(table)
    if (!map) return json({ message: `table non simulée : ${table}` }, 404)
    if (request.method() === 'POST') {
      const rows = [request.postDataJSON()].flat() as Row[]
      for (const row of rows) {
        const current = map.get(String(row.id))
        if (table === 'replacements' && current?.delivery_id && (current.replaced_at !== row.replaced_at || current.note !== row.note)) {
          return json({ message: 'Remplacement rattaché à une livraison : il ne peut pas être modifié.', code: '23514' }, 400)
        }
        map.set(String(row.id), { ...current, ...row, ...(table === 'replacements' ? { delivery_id: current?.delivery_id ?? null } : {}) })
      }
      return json([], 201)
    }
    if (request.method() === 'PATCH' && idFilter) {
      const patch = request.postDataJSON() as Row
      const current = map.get(idFilter)
      if (current) map.set(idFilter, { ...current, ...patch })
      return json([])
    }
    if (request.method() === 'DELETE' && idFilter) {
      if (table === 'replacements' && map.get(idFilter)?.delivery_id) {
        return json({ message: 'Remplacement rattaché à une livraison : il ne peut pas être supprimé.', code: '23514' }, 400)
      }
      map.delete(idFilter)
      if (table === 'deliveries') {
        for (const [id, r] of this.replacements) if (r.delivery_id === idFilter) this.replacements.set(id, { ...r, delivery_id: null })
      }
      return json([])
    }
    return json({ message: 'non simulé' }, 404)
  }

  private priceAt(date: string): number {
    const prices = this.prices.filter((p) => String(p.effective_from) <= date).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))
    const price = prices[0]?.unit_price_cents
    if (typeof price !== 'number') throw new Error('Aucun prix unitaire en vigueur.')
    return price
  }

  private rpc(fn: string, args: Row): unknown {
    switch (fn) {
      case 'is_admin':
        return this.admin
      case 'save_delivery': {
        const delivery = args.p_delivery as Row
        const ids = (args.p_replacement_ids ?? []) as string[]
        const id = String(delivery.id)
        const date = String(delivery.delivery_date)
        for (const rid of ids) {
          const r = this.replacements.get(rid)
          if (!r) throw new Error('Remplacement inconnu : synchronisez puis recommencez.')
          if (r.delivery_id && r.delivery_id !== id) throw new Error('Un remplacement est déjà rattaché à une autre livraison.')
          if (mauritiusDay(String(r.replaced_at)) > date) throw new Error('Un remplacement est postérieur à la date de livraison.')
        }
        const current = this.deliveries.get(id)
        const price = current && current.delivery_date === date ? Number(current.unit_price_cents_applied) : this.priceAt(date)
        const total = Number(delivery.bottles_total)
        const row: Row = {
          id,
          delivery_date: date,
          bottles_total: total,
          bottles_f1: ids.length,
          bottles_f2: total - ids.length,
          unit_price_cents_applied: price,
          document_path: current?.document_path ?? null,
          note: delivery.note ?? null,
          created_at: '2026-10-01T00:00:00Z',
        }
        this.deliveries.set(id, row)
        for (const [rid, r] of this.replacements) {
          if (ids.includes(rid)) this.replacements.set(rid, { ...r, delivery_id: id })
          else if (r.delivery_id === id) this.replacements.set(rid, { ...r, delivery_id: null })
        }
        return row
      }
      case 'rotate_share_link': {
        for (const link of this.shareLinks) link.revoked_at ??= new Date().toISOString()
        const created = { id: String(args.p_id), token_hash: String(args.p_token_hash), created_at: new Date().toISOString(), revoked_at: null }
        this.shareLinks.push(created)
        return { id: created.id, created_at: created.created_at }
      }
      case 'revoke_share_links': {
        let count = 0
        for (const link of this.shareLinks) {
          if (link.revoked_at === null) {
            link.revoked_at = new Date().toISOString()
            count += 1
          }
        }
        return count
      }
      case 'get_shared_view':
        return this.sharedView(String(args.p_token ?? ''))
      default:
        throw new Error(`RPC non simulée : ${fn}`)
    }
  }

  /** Même contenu que la fonction SQL : uniquement les données du Foyer 2. */
  sharedView(token: string): Row | null {
    const hash = createHash('sha256').update(token).digest('hex')
    if (!this.shareLinks.some((l) => l.token_hash === hash && l.revoked_at === null)) return null
    const f2 = [...this.deliveries.values()]
      .map((d) => ({ date: String(d.delivery_date), bottles: Number(d.bottles_total) - Number(d.bottles_f1), unit: Number(d.unit_price_cents_applied) }))
      .filter((d) => d.bottles > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
    const adjustments = [...this.soas.values()]
      .map((s) => {
        const variance = Number(s.variance_cents)
        const adjustment = s.variance_treatment === 'impute_to_f2' ? variance : s.variance_treatment === 'split_50_50' ? Math.trunc(variance / 2) + 0 : 0
        return { month: String(s.month).slice(0, 7), adjustment }
      })
      .filter((a) => a.adjustment !== 0)
    const months = [...new Set([...f2.map((d) => d.date.slice(0, 7)), ...adjustments.map((a) => a.month)])].sort().reverse()
    const repayments = [...this.repayments.values()].sort((a, b) => String(b.repayment_date).localeCompare(String(a.repayment_date)))
    const charges = f2.reduce((sum, d) => sum + d.bottles * d.unit, 0)
    const adjusted = adjustments.reduce((sum, a) => sum + a.adjustment, 0)
    const repaid = repayments.reduce((sum, r) => sum + Number(r.amount_cents), 0)
    return {
      generated_at: new Date().toISOString(),
      deliveries: f2.map((d) => ({ date: d.date, bottles: d.bottles, unit_price_cents: d.unit, amount_cents: d.bottles * d.unit })),
      months: months.map((month) => {
        const deliveries_cents = f2.filter((d) => d.date.startsWith(month)).reduce((sum, d) => sum + d.bottles * d.unit, 0)
        const adjustment_cents = adjustments.filter((a) => a.month === month).reduce((sum, a) => sum + a.adjustment, 0)
        return { month, deliveries_cents, adjustment_cents, total_cents: deliveries_cents + adjustment_cents }
      }),
      repayments: repayments.map((r) => ({ date: r.repayment_date, amount_cents: r.amount_cents })),
      balance_cents: charges + adjusted - repaid,
    }
  }
}

/** Fige l'horloge du navigateur (mercredi 14 octobre 2026, 9 h à Maurice). */
export async function freezeClock(page: Page, iso = '2026-10-14T09:00:00+04:00'): Promise<void> {
  await page.clock.setFixedTime(new Date(iso))
}
