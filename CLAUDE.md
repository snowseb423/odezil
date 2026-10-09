# EauPartagée — notes pour Claude

PWA mobile-first, **offline-first**, qui suit les remplacements de bonbonnes d'eau Odezil du **Foyer 1** (l'admin, seul utilisateur), répartit chaque livraison entre les deux foyers et calcule ce que le **Foyer 2** (beaux-parents) doit. Le Foyer 2 consulte une page en lecture seule `/p/:token`. Relire ce fichier à chaque session ; le plan détaillé est dans `docs/PLAN.md`.

Les patterns techniques et d'interface viennent du projet **Presence** (`snowseb423/presence_2026_2027`) : en cas de doute technique, faire comme Presence, sauf sur la sécurité et l'intégrité des montants (règles ci-dessous, prioritaires).

## Stack

- Vite 8 + React 19 + TypeScript 7 strict (`noUncheckedIndexedAccess`, `tsc -b` sur 3 tsconfig : app, sw, node) + Tailwind CSS 4 (`@tailwindcss/vite`).
- Routeur maison sur l'API History (`src/lib/router.ts`, repris de Presence), pas de React Router.
- vite-plugin-pwa en `injectManifest` : service worker écrit à la main (`src/sw.ts`, Workbox), mise à jour proposée par `UpdatePrompt` (`registerType: 'prompt'`).
- Dexie (IndexedDB) : miroir local et file d'écritures (`outbox`). `useLiveQuery` partout.
- Supabase : Postgres, Auth (Google + lien magique/code), Storage. supabase-js côté client uniquement, **aucune clé service_role** dans le projet ni sur Vercel.
- Tests : Vitest (+ fake-indexeddb), SQL dans **PGlite** (vraies migrations sur un bouchon Supabase), Playwright pour l'e2e. Lint : **oxlint** (typescript-eslint ne supporte pas TS 7).
- Déploiement : Vercel (intégration GitHub), `vercel.json` (réécriture SPA, CSP, en-têtes).

## Commandes

```bash
npm run dev         # http://localhost:5173
npm run lint        # oxlint (avertissements bloquants)
npm run typecheck   # tsc -b
npm test            # Vitest : domaine, synchro, SQL (PGlite), contrastes
npm run build       # tsc -b && vite build
npm run test:e2e    # Playwright (PLAYWRIGHT_CHROMIUM_EXECUTABLE pour un Chromium existant)
npm run icons       # régénère les icônes depuis scripts/icon*.svg
```

Avant chaque commit : `npm run lint && npm run typecheck && npm test && npm run build`.

## Structure

- `src/domain/` : **pur, sans React**. `calculations.ts` contient **toutes** les règles (attribution, prix, montants, écarts, solde) ; ne jamais les dupliquer ailleurs. `dates.ts` (fuseau `Indian/Mauritius`), `format.ts` (`Rs 1 200,00`), `recap.ts`.
- `src/data/` : `db.ts` (Dexie), `ops.ts` (opérations + application pure sur le miroir), `mirror.ts`, `rows.ts` (snake_case ↔ camelCase), `remote.ts` (REST, RPC, Storage derrière l'interface `Remote`), `sync.ts` (moteur), `commands.ts` (intentions → opérations validées), `documents.ts` (compression).
- `src/auth/`, `src/share/` (page Foyer 2, chunk séparé, sans Dexie ni session), `src/screens/`, `src/ui/`, `src/layout/`, `src/pwa/`, `src/lib/`.
- `supabase/migrations/` : SQL horodaté `YYYYMMDDHHMMSS_nom.sql`. **Ne jamais modifier une migration commitée** : en ajouter une.
- `tests/sql/` : migrations exécutées dans PGlite sur `tests/sql/supabase-stub.sql` (rôles, `auth`, `storage`).

## Conventions

- **Montants en centimes entiers** (`integer` en SQL, `number` entier en TS), jamais de flottants. Conversion aux bords : `parseRsToCents()` à la saisie, `formatRs()` à l'affichage (`Rs 1 200,00`, espace fine insécable, 2 décimales).
- **Dates** : chaînes `YYYY-MM-DD`, mois `YYYY-MM`. « Aujourd'hui » et le jour d'un horodatage se calculent en `Indian/Mauritius` (UTC+4, sans heure d'été), jamais en UTC ni dans le fuseau de l'appareil.
- **Ids UUID générés côté client.** Toute écriture passe par la file (`engine.commit(op)`) et doit être **idempotente** (upsert, delete, RPC idempotente). La file est rejouée **dans l'ordre, sans fusion** ; une opération refusée **bloque** la file (Réessayer / Abandonner).
- L'UI lit Dexie (miroir serveur + opérations en attente appliquées par `applyOps`). Le moteur vide la file puis relit toutes les tables, jamais en parallèle.
- Rien n'est stocké en double : totaux et soldes sont calculés. Seuls sont figés : `unit_price_cents_applied` (trigger à l'insertion, réévalué seulement si la date de livraison change), `bottles_f1` (attribution) et `variance_cents` (à l'enregistrement du SOA).
- UI **en français**, mobile-first, gros boutons, cibles ≥ 44 px, peu de champs.
- Commits conventionnels : `feat:`, `fix:`, `test:`, `chore:`, `docs:`.

## Palette froide (tokens)

Définie dans `src/styles/tokens.css`, exposée à Tailwind dans `index.css`. La palette par défaut de Tailwind est **désactivée** : aucune couleur codée en dur dans les composants.

| Token | Usage | Valeur |
|---|---|---|
| `bg` / `surface` / `surface-2` / `surface-3` | fonds | `#F4F8FB` / `#FFFFFF` / `#EDF3F8` / `#E2EBF2` |
| `border` / `border-strong` | filets / bordures de champs (3:1) | `#D9E4EC` / `#768CA0` |
| `text` / `text-muted` | textes | `#0F2233` / `#5B7083` |
| `primary` (`-hover`, `-soft`, `on-primary`) | actions, liens, bandeau | `#0369A1` (`#075985`, `#E0F2FE`, blanc) |
| `foyer-1` (`-ink`, `-soft`) | repère Foyer 1 | `#0284C7` (`#0369A1`, `#E0F2FE`) |
| `foyer-2` (`-ink`, `-soft`) | repère Foyer 2 | `#6366F1` (`#4F46E5`, `#EEF2FF`) |
| `success` / `warning` / `danger` (`-ink`, `-soft`) | soldé, synchro / écart, attente, avertissements / erreur, suppression | `#0D9488` / `#D97706` / `#E11D48` |

- Texte coloré : toujours la variante `-ink` (les teintes de base n'atteignent pas AA en texte). `tests/contrast.test.ts` vérifie toutes les paires.
- Aucune teinte chaude hors `warning` et `danger`. Les foyers se distinguent par cyan/bleu vs indigo **et** par un libellé, jamais par la couleur seule.
- Manifest : `theme_color` `#0369A1`, `background_color` `#F4F8FB`. Icône : goutte sur fond primary.

## Règle d'attribution (cœur de l'app)

- **Journal** : chaque remplacement = 1 bonbonne remplacée sur la fontaine du Foyer 1 (`replaced_at`). Il reste **en attente** tant qu'aucune livraison ne l'a rattaché.
- **Création d'une livraison** (date D, total T remplacé par Odezil) :
  1. candidats = remplacements en attente dont le **jour à Maurice** est ≤ D (jour D inclus) ;
  2. Foyer 1 = n = min(candidats, T), les **plus anciens d'abord** (tri `replaced_at`, puis `id`), rattachés à la livraison ;
  3. **Foyer 2 = T − n**, jamais saisi à la main ;
  4. excédent de candidats : reste en attente, avertissement « N remplacements reportés : plus de remplacements enregistrés que de bonbonnes livrées, vérifie tes saisies » ;
  5. aucun candidat : confirmation explicite « Aucun remplacement enregistré pour le Foyer 1 : toutes les bonbonnes seront attribuées au Foyer 2. » ;
  6. D antérieure à la dernière livraison : avertissement.
- **Figée à la création** : un remplacement rattaché est verrouillé (ni modifiable ni supprimable, cadenas et lien vers sa livraison). Corrections uniquement par « Recalculer la répartition » (aperçu avant/après du montant Foyer 2, puis confirmation), par modification de la date ou du total (même recalcul), ou par suppression de la livraison (ses remplacements repassent en attente).
- **Atomicité** : livraison + rattachements partent en **une seule opération**, la RPC `save_delivery(p_delivery jsonb, p_replacement_ids uuid[])` (`security invoker`, idempotente sur `deliveries.id`). La base garantit l'invariant quel que soit le chemin : contrainte différée (`bottles_f1` = nombre de rattachés, jour ≤ D) et trigger de verrou.
- Calculs (`src/domain/calculations.ts`) : part Foyer 2 = `bottles_f2 × unit_price_cents_applied` ; total attendu d'un mois = Σ `bottles_total × prix appliqué` ; écart = SOA − attendu ; ajustement Foyer 2 = `impute_to_f2` → écart, `split_50_50` → écart ÷ 2 tronqué vers zéro, sinon 0 (identique à la colonne générée `f2_adjustment_cents`, test de parité) ; **solde Foyer 2 = Σ parts Foyer 2 + Σ ajustements − Σ remboursements**.

## Sécurité (règles non négociables)

1. **RLS activée sur toutes les tables**, `revoke all … from anon, authenticated`, aucun droit ni politique pour `anon`. Grants minimaux à `authenticated` (par colonne si utile), politiques `(select public.is_admin())`.
2. **Piège Google OAuth** : n'importe quel compte Google obtient une session. Une session ne prouve rien. `public.is_admin()` (`security definer`, `search_path = ''`) exige : email du JWT (minuscules) dans `admin_allowlist`, identique à l'email de `auth.users` pour `auth.uid()`, email confirmé, session non ouverte par mot de passe (`amr`). Elle protège toutes les tables, les RPC et le bucket. Le trigger `guard_signup` refuse en plus la création de comptes hors allowlist.
3. `admin_allowlist` n'est **jamais** remplie par une migration (pas d'email commité) : requête SQL dans le README.
4. Côté interface : après connexion, comparaison avec `VITE_ADMIN_EMAIL` (garde-fou d'interface seulement) puis RPC `is_admin()` ; si faux, déconnexion, effacement de Dexie et « Accès non autorisé ».
5. Auth : flux **PKCE** (`/auth/callback`), lien magique + code à 6 chiffres en secours. **Redirect URLs Supabase exactes uniquement** (production, `http://localhost:5173/**`, `http://localhost:4173/**`) : jamais de joker `*.vercel.app` ni `*-<équipe>.vercel.app`.
6. Page `/p/:token` : token aléatoire de 32 octets (base64url, Web Crypto), seul son **hash SHA-256 (hex)** est stocké, un seul lien actif (révocable, régénérable, affiché une seule fois). RPC `get_shared_view(p_token)` (`security definer`, exécutable par `anon`) : renvoie `null` si invalide ou révoqué, et **uniquement** des données du Foyer 2 (livraisons avec `bottles_f2 > 0` : date, bouteilles F2, prix, montant ; totaux mensuels F2 et `f2_adjustment_cents` ; remboursements ; solde). **Jamais** `bottles_total`, `bottles_f1`, remplacements, montants du Foyer 1, total SOA, `variance_*`, notes, chemins de documents.
7. La page partagée n'ouvre pas Dexie, ne persiste aucune session, ajoute `<meta name="referrer" content="no-referrer">` ; `vercel.json` ajoute `no-store`, `noindex` et `no-referrer` sur `/p/(.*)`.
8. Bucket Storage `documents` **privé** (JPEG, PNG, WebP, PDF ; 10 Mo), politiques `is_admin()`, chemins `deliveries/{delivery_id}/…` et `soa/{yyyy-mm}/…`, URLs signées de 60 s.
9. Le service worker ne met **rien** en cache à l'exécution (aucune route cross-origin) : ni RPC, ni REST, ni Storage.
10. Nouvelle table : RLS, revoke, grants minimaux, politique `is_admin()`, test dans `tests/sql/`. Les tests SQL couvrent deux configurations : droits par défaut de Supabase accordés, et mode strict.
11. Nouvelle fonction SQL : aucun droit implicite (`alter default privileges` retire EXECUTE à PUBLIC) ; `grant execute` au seul rôle utile.
12. Secrets uniquement en variables d'environnement front (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` ou `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_EMAIL`), valeurs publiques par nature. Ne jamais commiter de `.env*` autre que `.env.example`.

## Hors périmètre

Paiement en ligne, intégration bancaire, OCR, notifications, comptes pour les beaux-parents, gestion de stock, Supabase Realtime.
