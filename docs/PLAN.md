<!-- Plan validé le 2026-10-09. Le code peut avoir évolué depuis : CLAUDE.md fait foi pour les règles. -->

# Plan — EauPartagée (PWA bonbonnes Odezil)

## Contexte

Le dépôt `snowseb423/odezil` est vide (README seul) : on repart de zéro. L'app suit les remplacements de bonbonnes du Foyer 1, répartit automatiquement chaque livraison Odezil entre les deux foyers, rapproche les SOA mensuels et calcule ce que le Foyer 2 doit. Le Foyer 2 consulte une page en lecture seule `/p/:token`.

Référence : j'ai lu **Presence** (`snowseb423/presence_2026_2027`) en entier : `package.json`, `vite.config.ts`, `src/sw.ts`, `src/data/*`, `src/auth/*`, `src/lib/router.ts`, `src/ui/*`, `src/layout/*`, `src/styles/*`, la migration, les tests SQL (PGlite) et de synchro, `vercel.json` et le README. Je reprends ses patterns, pas ses données ni sa logique métier.

Travail sur la branche `claude/clever-ramanujan-49ik5m`. Elle est déjà fusionnée (PR #5), donc je la repars de `main`. Un commit par étape, poussé à chaque fois. Pas de PR sans ta demande.

---

## 1. Ce que je reprends de Presence, et les écarts

### Repris tel quel

- **Versions** : React 19.3, Vite 8, TypeScript 7 (`tsc -b`, 3 tsconfig app/sw/node), Tailwind 4 (`@tailwindcss/vite`), vite-plugin-pwa 1.3 (`injectManifest`, `src/sw.ts` Workbox), Dexie 4 + dexie-react-hooks, supabase-js 2.117, lucide-react, Vitest 5, fake-indexeddb, PGlite, Playwright.
- **Polices auto-hébergées** : Bricolage Grotesque pour les titres, Atkinson Hyperlegible Next pour le texte. Précachées, elles restent disponibles hors-ligne.
- **Service worker** : précache du shell, `NavigationRoute` → `index.html` (donc `/p/*` et `/auth/callback`), `offline.html` en dernier recours, `UpdatePrompt` (« Nouvelle version disponible », vérification toutes les heures), `install.ts` (`beforeinstallprompt` et aide iOS).
- **Données** : l'UI lit le miroir Dexie, avec les opérations en attente appliquées par-dessus (`applyOps`, fonction pure). La file `outbox` est rejouée dans l'ordre, sous un verrou inter-onglets (`navigator.locks`). Backoff `[2, 5, 15, 30, 60] s`. Relance sur `online` et `visibilitychange`. Classement des erreurs `network | server | auth | rejected` et `refreshSession` sur 401 (`remote.ts`, `sync.ts`). Interface `Remote` injectable, testée avec un `FakeServer`.
- **Auth** : `AuthProvider` tolérant au hors-ligne (utilisateur en cache et session stockée, l'app s'ouvre sans réseau), `LoginScreen` (bouton Google affiché seulement si le fournisseur est actif, `/auth/v1/settings`, logo G officiel), `describeRedirectError`, `prompt: 'select_account'`, lien magique **et code à 6 chiffres** (indispensable pour l'app installée sur iPhone), trigger `guard_signup` sur `auth.users` (refuse la création de tout compte hors allowlist).
- **UI** : `AppShell` (bandeau haut et zones sûres iOS, feuille qui le recouvre, barre de navigation au pouce), `SyncPill` et sa feuille de détail, `Sheet` (`<dialog>` natif), `Toaster` avec action « Annuler », `Button`, `Card`, `Stepper`, `Field`, `Select`, chiffres tabulaires, `prefers-reduced-motion`.
- **Thème** : structure des tokens (`tokens.css`, puis `@theme inline`), variantes `-soft` et `-ink`, test automatique des contrastes AA (`tests/contrast.test.ts`).
- **Tests SQL** : les vraies migrations sont exécutées dans PGlite, par-dessus un bouchon Supabase (rôles, `auth.jwt()`, `auth.uid()`). Helper `as(user, fn)`.
- **Divers** : `vercel.json` (réécriture SPA, CSP, cache immuable des assets, pas de cache pour `sw.js` ni `index.html`), CI GitHub Actions, `docs/PLAN.md` (j'y recopie ce plan) et structure de dossiers `src/{domain,data,auth,pwa,ui,layout,screens,export,lib}`.

### Écarts, à valider

| Sujet | Presence | Prompt | Choix | Raison |
|---|---|---|---|---|
| Flux OAuth | implicite, retour sur `/` | PKCE et `/auth/callback` | **PKCE et `/auth/callback`** | Sécurité : les jetons ne passent jamais dans l'URL. Même expérience : le code à 6 chiffres reste le secours sur iPhone. |
| `is_admin()` | email du JWT dans la liste | idem | **plus strict** : email du JWT dans l'allowlist, égal à celui de `auth.users` pour `auth.uid()`, email confirmé, session non ouverte par mot de passe (claim `amr`) | Empêche la prise de contrôle d'un compte pré-créé par mot de passe (faille réelle si les confirmations sont désactivées). |
| Redirect URLs | joker `*-<équipe>.vercel.app/**` | « previews Vercel » | **URLs exactes uniquement** (prod, `localhost:5173/**`, `localhost:4173/**`). Une preview n'est ajoutée qu'avec son URL exacte de branche, si besoin. | Un `*` accepte les tirets : un projet Vercel tiers pourrait recevoir le code OAuth ou le lien magique. |
| Routeur | maison (History API, ~40 lignes) | React Router | **routeur de Presence**, étendu aux motifs `/p/:token` | Suivre Presence (point technique) ; aucune dépendance de plus. |
| Mise à jour du SW | `prompt` (bandeau « Mettre à jour ») | automatique | **Presence** | Pas de rechargement surprise pendant une saisie. |
| Cache des données dans le SW | stale-while-revalidate sur `/rest/v1` | — | **aucun cache runtime cross-origin** | Il servait surtout le temps réel, ici absent. Dexie est déjà la copie hors-ligne. Garantit qu'aucune réponse RPC ou Storage n'est mise en cache. |
| Temps réel, mode local | Realtime ; app utilisable sans Supabase | pas de Realtime | **ni l'un ni l'autre** | Hors périmètre ; la page partagée exige Supabase. Sans configuration, un écran indique les variables manquantes. |
| Fusion des opérations en file | une opération par clé, fusionnée sur place | ordre strict | **pas de fusion**, ajout pur | Une fusion sur place peut faire passer une livraison avant les remplacements qu'elle rattache. |
| Opération refusée par le serveur | supprimée, la file continue | « Réessayer » | **la file s'arrête sur l'opération en échec**, avec message, « Réessayer » et « Abandonner » (abandon suivi d'un rechargement depuis le serveur) | Ne jamais rejouer une livraison après un remplacement perdu. |
| Clé publique | `VITE_SUPABASE_PUBLISHABLE_KEY` (ou `ANON_KEY`) | `VITE_SUPABASE_ANON_KEY` | **les deux acceptées**, plus `VITE_ADMIN_EMAIL` | Compatible avec les nouvelles clés Supabase. |
| Lint | absent | `npm run lint` | **oxlint** (TS, React et hooks) | typescript-eslint exige TS < 6.1, incompatible avec le TS 7 de Presence. |
| Isolation | PGlite | `supabase start` | **PGlite**, en deux configurations : droits par défaut de Supabase et mode strict | Sans Docker, tourne en CI ; mêmes migrations. Le bouchon imite aussi `storage.buckets`, `storage.objects` et `storage.foldername`. |
| Thème | clair et sombre, sélecteur | clair | **clair uniquement** (sans `theme-init.js`) | Identité demandée. Les tokens permettront d'ajouter un sombre plus tard. |
| Montants | `Rs 12 276` | `Rs 1 200,00` | **toujours 2 décimales** (`formatRs` de Presence, `fixed` par défaut) | Format métier du prompt. |
| Dossier des calculs | `src/domain/` | `src/lib/calculations.ts` | **`src/domain/calculations.ts`** | Structure de Presence. |
| Lighthouse PWA | — | audit PWA | Lighthouse ≥ 12 n'a plus de catégorie PWA : je vérifie l'installabilité (manifest, SW, icônes, `start_url`) par test e2e, plus Lighthouse accessibilité et bonnes pratiques | La catégorie n'existe plus. |
| Cloudflare `_headers` | présent | Vercel seul | supprimé | Simplicité. |

---

## 2. Architecture

```
src/
  main.tsx              # /p/* → SharedApp (chunk séparé, sans Dexie ni session) ; sinon App
  App.tsx               # ToastProvider > AuthProvider > Gate > DataProvider > écrans
  env.ts  sw.ts  vite-env.d.ts
  domain/               # PUR, testé : types, dates (Maurice), format, calculations, recap
  data/                 # db (Dexie), ops (overlay pur), mirror, rows, remote (REST, RPC, Storage),
                        # sync (moteur), commands (intentions → ops validées), documents (compression)
  auth/                 # AuthProvider, LoginScreen, AuthCallback, redirect
  share/                # SharedView, client anonyme sans persistance, manifest d'exécution
  pwa/ ui/ layout/ lib/ # repris de Presence (router, platform, useToday)
  screens/              # Home, Journal, Deliveries (+ DeliverySheet), Months (+ SoaSheet, RecapSheet),
                        # Balance (remboursements), Settings
  styles/               # tokens.css (palette froide), fonts.css, index.css
supabase/  migrations/  config.toml  templates/magic_link.html
tests/     sql/ (schema, rls, shared-view, parity)  contrast.test.ts
e2e/       login, offline, shared (faux Supabase, comme Presence)
```

### Données hors-ligne

- **Dexie** : `prices`, `replacements` (index `deliveryId`, `replacedAt`), `deliveries`, `soas` (`&month`), `repayments`, `shareLink` (lien actif, sans hash), `outbox` (`++id`, Blobs inclus), `meta`.
- **Opérations** (ids UUID générés par le client, toutes idempotentes) :
  - `replacement.upsert`, `replacement.delete` ;
  - `delivery.save` (RPC atomique `save_delivery`), `delivery.delete` ;
  - `document.attach` : envoi Storage en `upsert`, puis `document_path` sur la ligne, puis suppression de l'ancien fichier. Le Blob reste dans la file jusqu'au succès ;
  - `document.detach` ;
  - `soa.save`, `soa.delete` ;
  - `repayment.save`, `repayment.delete` ;
  - `price.save`, `price.delete`.
- **Moteur** : une seule boucle sérialisée, vider la file puis relire toutes les tables. Pas de relecture pendant un envoi, sinon un instantané périmé écraserait le résultat. Déclencheurs : démarrage, `online`, retour au premier plan (> 60 s), après chaque saisie, bouton « Synchroniser ». Le résultat serveur (par exemple la livraison avec son prix figé) est écrit dans le miroir dans la même transaction que la suppression de l'entrée de file.
- **Attribution** : calculée localement avec `allocateDelivery` sur l'état affiché, puis envoyée en **une seule opération**. L'aperçu local et le serveur appliquent les mêmes règles.
- **Documents** : images réduites à 1600 px de côté long, JPEG qualité 0,7 (`createImageBitmap` et canvas) ; PDF envoyés tels quels. Un document encore en attente s'affiche depuis le Blob local. Un document déjà envoyé s'ouvre par URL signée de 60 s, **en ligne uniquement**, puisque le SW ne met rien en cache.

### Auth admin

- Client `flowType: 'pkce'`, `detectSessionInUrl`, `persistSession`, `autoRefreshToken`.
- Google renvoie sur `/auth/callback`, qui affiche « Connexion… » puis navigue vers `/`.
- Après connexion, deux contrôles :
  1. garde-fou d'interface : l'email doit correspondre à `VITE_ADMIN_EMAIL` ;
  2. RPC `is_admin()` : si elle renvoie faux, déconnexion, effacement de Dexie et « Accès non autorisé ».

  Le contrôle est refait à chaque démarrage en ligne ; hors-ligne, la session en cache suffit.
- La garde de routes est le `Gate` de Presence : sans session, l'écran de connexion s'affiche.
- Déconnexion : avertissement s'il reste des opérations en attente, puis effacement de Dexie.

### Page partagée `/p/:token`

- Chunk à part, avec son propre client Supabase anonyme (`persistSession: false`, autre `storageKey`). Rien n'est stocké.
- RPC `get_shared_view`. Si elle renvoie `null` : page générique « Lien invalide ».
- Bouton « Actualiser », relecture au retour au premier plan, mention « Dernière mise à jour : … », message clair si hors-ligne.
- `<meta name="referrer" content="no-referrer">` est ajouté à l'exécution, car une page servie par le SW ne reçoit pas les en-têtes Vercel. `noindex` est global.
- Manifest d'exécution (`start_url` = URL courante, `id` = `/p/`) via une URL `data:`. C'est du best effort, pris en compte par Chrome Android.

---

## 3. Schéma SQL

Trois migrations : `…_schema.sql` (tables, triggers, RLS), `…_rpc.sql` (fonctions) et `…_storage.sql` (bucket, politiques).

- **Prix initial** : la migration insère Rs 240 avec une date d'effet au `2000-01-01`. C'est une donnée de référence, pas un secret.
- **`admin_allowlist`** : jamais remplie par une migration. Le README donne la requête SQL.

```sql
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;

create table admin_allowlist (email text primary key check (email = lower(btrim(email)) and email like '%_@_%'));
create table price_settings (id uuid primary key, unit_price_cents int not null check (unit_price_cents > 0),
  effective_from date not null unique, created_at timestamptz not null default now());
create table deliveries (id uuid primary key, delivery_date date not null,
  bottles_total int not null check (bottles_total > 0),
  bottles_f1 int not null check (bottles_f1 >= 0 and bottles_f1 <= bottles_total),
  bottles_f2 int generated always as (bottles_total - bottles_f1) stored,
  unit_price_cents_applied int not null check (unit_price_cents_applied > 0),
  document_path text check (document_path ~ '^deliveries/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  note text check (char_length(note) <= 500), created_at timestamptz not null default now());
create table replacements (id uuid primary key, replaced_at timestamptz not null,
  replaced_on date generated always as ((replaced_at at time zone 'Indian/Mauritius')::date) stored,
  note text check (char_length(note) <= 500),
  delivery_id uuid references deliveries(id) on delete set null,   -- suppression → « en attente »
  created_at timestamptz not null default now());
create table soa_statements (id uuid primary key, month date not null unique check (extract(day from month) = 1),
  total_billed_cents int not null check (total_billed_cents >= 0), variance_cents int not null,
  variance_treatment text not null default 'pending'
    check (variance_treatment in ('pending','impute_to_f1','impute_to_f2','split_50_50')),
  f2_adjustment_cents int generated always as (case variance_treatment
    when 'impute_to_f2' then variance_cents when 'split_50_50' then variance_cents / 2 else 0 end) stored,
  document_path text check (document_path ~ '^soa/\d{4}-\d{2}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  note text check (char_length(note) <= 500), created_at timestamptz not null default now());
create table repayments (id uuid primary key, repayment_date date not null,
  amount_cents int not null check (amount_cents > 0), note text check (char_length(note) <= 500),
  created_at timestamptz not null default now());
create table share_links (id uuid primary key, token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(), revoked_at timestamptz);
create unique index share_links_one_active on share_links ((true)) where revoked_at is null;
```

Notes sur ce schéma :
- `variance_treatment` est un `text` avec contrainte plutôt qu'un type `enum` : un littéral d'enum n'est pas immuable, donc interdit dans la colonne générée.
- `variance_cents / 2` en SQL tronque vers zéro, comme `Math.trunc` en TS. Un test de parité le vérifie.

### Fonctions et triggers

L'intégrité est garantie par la base, quel que soit le chemin d'écriture.

- **`is_admin()`** : `security definer`, `search_path = ''`, `execute` pour `authenticated` seulement. Conditions : email du JWT en minuscules présent dans l'allowlist ; même email dans `auth.users` pour `auth.uid()` ; email confirmé ; `amr` sans `password`.
- **`guard_signup()`** : trigger sur `auth.users`, repris de Presence, en version allowlist.
- **`price_at(date)`** et trigger `deliveries_price` : le prix est figé à l'insertion. Il n'est réévalué que si `delivery_date` change ; un changement de prix ne touche jamais une livraison existante.
- **`replacements_lock`** : un remplacement rattaché ne peut être ni supprimé, ni modifié (`replaced_at`, `note`). Seul `delivery_id` peut changer.
- **Contrainte différée** (`constraint trigger … deferrable initially deferred`), vérifiée au commit :
  - `bottles_f1` = nombre de remplacements rattachés ;
  - chaque remplacement rattaché a un `replaced_on` ≤ `delivery_date`.

  Une écriture REST directe ne peut donc pas casser l'invariant.
- **`save_delivery(p_delivery jsonb, p_replacement_ids uuid[]) returns jsonb`** : `security invoker` (RLS appliquée), vérifie `is_admin()`, idempotente sur `deliveries.id`. Étapes :
  1. upsert de la livraison (`bottles_f1` = nombre d'ids) ;
  2. détache ses remplacements absents de la liste ;
  3. vérifie l'existence, l'absence de rattachement à une autre livraison, la date ≤ D et l'absence de doublon ;
  4. rattache ;
  5. renvoie la ligne, avec le prix figé.

  Le recalcul est le même appel avec le même id.
- **`rotate_share_link(p_id uuid, p_token_hash text)`** : `security invoker`, révoque le lien actif et en insère un nouveau, atomiquement. La révocation seule passe par un `update` REST. Génération et révocation exigent le réseau.
- **`get_shared_view(p_token text) returns jsonb`** : `security definer`, `search_path = ''`, `execute` pour `anon` et `authenticated`. Elle refuse les longueurs aberrantes, hache avec `encode(sha256(convert_to(p_token,'UTF8')),'hex')` (natif, sans pgcrypto) et vérifie le lien actif.

  Elle renvoie :
  - `generated_at` ;
  - `deliveries` : date, `bottles_f2`, prix unitaire, montant ; seulement celles où `bottles_f2 > 0`, pour ne même pas révéler les livraisons propres au Foyer 1 ;
  - `months` : total des livraisons du Foyer 2, `f2_adjustment_cents`, total ;
  - `repayments` : date, montant ;
  - `balance_cents`.

  Jamais `bottles_total`, `bottles_f1`, `replacements`, notes, chemins de documents, `variance_*` ni total SOA.

### RLS et droits

- Sur chaque table : `enable row level security`, puis `revoke all … from anon, authenticated`.
- Grants minimaux à `authenticated`, par colonne quand c'est utile. Par exemple, `replacements` : `insert (id, replaced_at, note)` ; `update (replaced_at, note, delivery_id)`, ce dernier pour la RPC `invoker`, sous la garde de la contrainte différée.
- Politiques `(select public.is_admin())` partout. `admin_allowlist` n'a aucune politique, donc reste illisible.

### Storage

- Bucket `documents` privé : 10 Mo maximum ; types JPEG, PNG, WebP et PDF.
- Politiques `select`, `insert`, `update`, `delete` pour `authenticated` : `bucket_id = 'documents' and is_admin()`, et premier dossier `deliveries` ou `soa`.

---

## 4. Règles de calcul (`src/domain/calculations.ts`, fonctions pures)

- **`mauritiusDateOf(iso)`** (`Intl`, `Indian/Mauritius`) et **`mauritiusLocalToIso(date, heure)`** (`+04:00` fixe : pas d'heure d'été depuis 2009).
- **`priceAt(date, prices)`** : même règle que `price_at` en SQL.
- **`allocateDelivery({ deliveryDate, bottlesTotal, replacements, previousDeliveryDate? })`** :
  1. candidats : en attente (ou déjà rattachés à cette livraison en cas de recalcul), avec date de Maurice ≤ D ;
  2. tri par `replaced_at`, puis par `id` ;
  3. n = min(candidats, T) ; les plus anciens sont rattachés ;
  4. renvoie `{ bottlesF1, bottlesF2, attachedIds, carriedOverIds, warnings }`. Avertissements : `carried_over` (N), `none_recorded` (confirmation requise), `earlier_than_last`.
- **Montants** :
  - part Foyer 2 d'une livraison = `bottles_f2 × prix appliqué` ;
  - total attendu d'un mois = Σ `bottles_total × prix` ;
  - écart = SOA − attendu ;
  - `f2Adjustment(variance, treatment)` reproduit exactement la colonne générée ;
  - solde du Foyer 2 = Σ parts Foyer 2 + Σ ajustements − Σ remboursements.
- **SOA périmé** : si les livraisons du mois changent après le rapprochement (total attendu ≠ total SOA − écart figé), l'historique affiche « Livraisons modifiées depuis le rapprochement » et propose de le refaire.
- **Récapitulatif d'un mois M** :
  - montant de M = parts Foyer 2 de M + ajustement de M ;
  - solde antérieur = charges avant M − tous les remboursements ;
  - total = solde antérieur + montant de M ;
  - la ligne « Solde antérieur » n'apparaît que si elle est non nulle ;
  - plusieurs prix dans le mois donnent plusieurs lignes `n × Rs`.
- **Statistiques** : consommation par mois et moyenne par semaine (journal).

---

## 5. Écrans

Barre du bas à 5 onglets : **Accueil · Journal · Livraisons · Mois · Solde**. Les Réglages s'ouvrent depuis une icône dans l'en-tête.

1. **Connexion** : gros bouton « Se connecter avec Google », puis « Recevoir un lien par email » (lien et code), erreurs claires.
2. **Accueil** :
   - très gros bouton « Bonbonne remplacée », verrouillé 2 s après un appui ;
   - toast « Annuler » pendant 6 s ;
   - « N remplacements depuis la dernière livraison », les derniers remplacements ;
   - carte « Solde Foyer 2 », accès « Nouvelle livraison ».
3. **Journal** :
   - liste par jour (heure de Maurice), statut « en attente » ou cadenas « Livraison du … », avec lien vers la livraison ;
   - ajout d'un oubli (date et heure, jamais dans le futur) ;
   - suppression d'une entrée en attente, avec confirmation ;
   - statistiques.
4. **Livraisons** :
   - liste ;
   - feuille « Nouvelle livraison » : date (aujourd'hui par défaut), compteur ± du total, aperçu en direct `Foyer 1 : n / Foyer 2 : T − n × Rs 240 = Rs …`, avertissements, confirmation si aucun remplacement n'est enregistré ;
   - bon de livraison : caméra, image ou PDF ; note ;
   - sur une livraison : voir, télécharger ou remplacer le bon ; modifier la date ou le total, ou « Recalculer la répartition », avec aperçu avant/après du montant du Foyer 2 et confirmation ; supprimer, avec confirmation.
5. **Mois** (historique et rapprochement) :
   - une carte par mois : livraisons, total livré, répartition Foyer 1 / Foyer 2, attendu, SOA, écart (`warning` si non nul), statut, bons et SOA du mois ;
   - feuille SOA : total, document, écart, traitement obligatoire si l'écart est non nul (`pending` explicite accepté) ;
   - « Message récapitulatif », avec bouton Copier ;
   - export CSV.
6. **Solde** : solde en grand, remboursements (date et montant ; ajouter, modifier, supprimer avec confirmation).
7. **Réglages** :
   - prix et date d'effet (historique) ;
   - lien Foyer 2 : générer (lien complet affiché une seule fois, bouton Copier), révoquer ;
   - synchronisation ;
   - installation ;
   - déconnexion ;
   - version.
- **En-tête** : `SyncPill` (« Hors ligne », « N en attente » en `warning`, « Erreur » en `danger` avec Réessayer/Abandonner), et bandeau discret « Hors ligne » sous l'en-tête.

## 6. Thème froid

Les tokens de `tokens.css` reprennent les valeurs du prompt (`bg`, `surface`, `border`, `text`, `text-muted`, `primary` et `primary-hover`, `primary-soft`, `foyer-1`, `foyer-2`, `success`, `warning`, `danger`) et y ajoutent :
- des variantes `-ink` pour le texte coloré, car certaines teintes du prompt échouent en AA sur fond clair : `warning` #D97706 → `warning-ink` #B45309 ; `success` → #0F766E ; `foyer-2` → #4F46E5 ; `foyer-1` → #0369A1 ; `danger` → #BE123C ;
- des variantes `-soft` pour les fonds.

Bandeau d'en-tête = `primary`, avec une lueur cyan. Le blanc sur #0369A1 atteint 5,9:1. Manifest : `theme_color` #0369A1, `background_color` #F4F8FB. Icônes : goutte stylisée sur fond `primary`, générées par `scripts/generate-icons.mjs` (repris de Presence). `tests/contrast.test.ts` vérifie toutes les paires.

## 7. Étapes et commits

1. `chore:` scaffolding Vite/React/TS/Tailwind/PWA aux versions de Presence, `src/sw.ts`, `vercel.json` (CSP et en-têtes `/p/(.*)`), `tsconfig` ×3, oxlint, CI, tokens froids, polices, test des contrastes, `CLAUDE.md`, `docs/PLAN.md`, `.env.example`.
2. `feat:` migrations (tables, triggers, RLS, `is_admin`, `guard_signup`, RPC, bucket), bouchon Supabase et `tests/sql` : RLS non-admin et anon, dans les deux configurations ; atomicité et idempotence de `save_delivery` ; verrou ; contrainte différée ; `get_shared_view`.
3. `feat:` `domain/` (dates, format, calculations, recap) et tests : attribution (nominal, aucun remplacement, report, jour même, frontière de fuseau à 01 h de Maurice, date antérieure, recalcul avant/après, suppression, verrou), prix avec date d'effet, écarts SOA (positif, négatif, nul) et les trois traitements, parité TS/SQL, solde après remboursements partiels ou groupés, centimes.
4. `feat:` auth (PKCE, `/auth/callback`, connexion, lien et code, `is_admin`, `Gate`, déconnexion) et tests (`redirect`, refus d'un compte non autorisé).
5. `feat:` Dexie, opérations, miroir, moteur de synchro, documents, et tests avec fake-indexeddb : rejeu idempotent, ordre remplacements → livraison, atomicité, reprise après échec, file bloquée puis Réessayer, document en attente.
6. `feat:` `AppShell`, navigation, Accueil « Bonbonne remplacée » et Journal.
7. `feat:` livraisons : attribution, aperçu, recalcul, bons.
8. `feat:` Mois : SOA, rapprochement, documents.
9. `feat:` Solde, remboursements, message récapitulatif.
10. `feat:` page `/p/:token` et test d'isolation, plus Réglages (lien de partage).
11. `feat:` historique complet et export CSV.
12. `chore:` icônes, manifest, e2e Playwright (connexion, remplacement hors-ligne puis resynchro, page partagée sans données du Foyer 1, cache SW sans URL Supabase), README complet (Supabase, Google OAuth, URLs, allowlist, variables, Vercel, installation iPhone et Android).

## 8. Vérification

- À chaque commit : `npm run lint && npm run typecheck && npm test && npm run build`.
- Étape 12 :
  - `npm run test:e2e`, avec Chromium déjà installé (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/...`) ;
  - Lighthouse (accessibilité, bonnes pratiques) sur `vite preview`.
- Hors de ma portée : vrai projet Supabase, vrai Google OAuth, déploiement Vercel. Tu les valides avec le README. Je te donnerai la liste des réglages à faire dans les tableaux de bord : projet Supabase, migrations, allowlist, Google provider, URLs exactes, modèle d'email avec code, nouveau projet Vercel et variables.
