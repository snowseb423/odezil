# EauPartagée — notes pour Claude

PWA mobile-first qui suit les livraisons de bonbonnes d'eau Odezil partagées entre deux foyers et calcule ce que le foyer **Cardinal** (B, beaux-parents) doit au foyer **Macoua** (A, l'admin). Relire ce fichier à chaque session.

## Stack

- Next.js 16 (App Router), React 19, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind CSS 4.
- **Next 16 n'est pas le Next de vos souvenirs** : lire `node_modules/next/dist/docs/` avant d'utiliser une API. Le middleware s'appelle désormais `proxy.ts` (fonction `proxy`). `next lint` n'existe plus, `npm run lint` lance `eslint .`.
- Supabase : Postgres, Auth (provider Google + lien magique de secours), Storage. Migrations dans `supabase/migrations/`.
- `@supabase/ssr` pour les sessions par cookies (flux PKCE), `zod` pour la validation serveur.
- Tests : Vitest. Les tests base de données utilisent **PGlite** (Postgres en WASM), sans Docker. Ils appliquent les vraies migrations par-dessus `tests/db/supabase-stubs.sql`, qui imite les schémas `auth` et `storage` et les rôles Supabase.
- Déploiement : Vercel via l'intégration GitHub.

## Commandes

```bash
npm run dev         # serveur de dev (http://localhost:3000)
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (unitaires + RLS via PGlite)
npm run build       # build de production
npm run seed:admin  # insère ADMIN_EMAIL dans admin_allowlist (clé service_role, .env.local)
```

Avant chaque commit : `npm run lint && npm run typecheck && npm test && npm run build`.

## Structure

- `app/(admin)/…` : écrans admin (session obligatoire). `app/login`, `app/auth/callback` : authentification. `app/p/[token]` : page Cardinal en lecture seule.
- `lib/calculations.ts` : **toutes** les règles de calcul, en fonctions pures et testées. Ne pas dupliquer ces règles ailleurs.
- `lib/money.ts` (format `Rs 1 200,00`, parsing), `lib/dates.ts` (fuseau `Indian/Mauritius`), `lib/recap.ts`, `lib/csv.ts`.
- `lib/supabase/` : clients `server.ts` (session cookies, soumis au RLS), `browser.ts`, `proxy.ts` et `service.ts` (clé service_role, `server-only`).
- `lib/auth.ts` : `isAuthorizedAdmin()` et `requireAdmin()`.
- `supabase/migrations/` : SQL versionné, horodaté `YYYYMMDDHHMMSS_nom.sql`. Ne jamais modifier une migration déjà commitée : en ajouter une nouvelle.

## Conventions

- **Montants en entiers (centimes de roupie)**, jamais de flottants, en TS comme en SQL (`integer`). Conversion uniquement aux bords : `parseRsToCents()` pour les saisies, `formatRs()` pour l'affichage.
- **Dates** : chaînes `YYYY-MM-DD` (type SQL `date`), mois `YYYY-MM`. Pas d'objet `Date` pour la logique métier. « Aujourd'hui » = fuseau `Indian/Mauritius`.
- UI **en français**, mobile-first, gros boutons, peu de champs. Montants affichés `Rs 1 200,00` (espaces insécables, 2 décimales).
- Foyer A = Macoua (admin), foyer B = Cardinal. Les colonnes SQL `bottles_a`/`bottles_b` suivent cette convention.
- Rien n'est stocké en double : totaux et soldes sont calculés. Seul `variance_cents` (écart SOA) est figé à l'enregistrement du SOA, conformément au cahier des charges. `unit_price_cents_applied` est figé par un trigger à l'insertion d'une livraison.
- Les livraisons et les remboursements ne se modifient pas : on les supprime puis on les ressaisit.
- Mutations par server actions validées avec zod ; chaque action appelle `requireAdmin()` en premier.
- Commits conventionnels : `feat:`, `fix:`, `test:`, `chore:`, `docs:`.

## Sécurité (règles non négociables)

1. **RLS activé sur toutes les tables**, aucun droit ni politique pour `anon`.
2. **Piège Google OAuth** : n'importe quel compte Google obtient une session Supabase valide. Une session ne prouve donc rien. Toutes les politiques RLS (tables **et** bucket Storage) passent par `public.is_admin()`. Cette fonction `security definer` exige que l'email du JWT, en minuscules, figure dans `admin_allowlist`, qu'il corresponde à `auth.uid()` et que l'email soit confirmé.
3. Côté serveur, après connexion et dans le proxy, le layout admin et **chaque server action** : email confirmé **et** égal à `ADMIN_EMAIL`. Sinon, déconnexion et message « Accès non autorisé ». Le proxy seul ne suffit jamais.
4. L'admin accède aux données **uniquement** via sa session (client `lib/supabase/server.ts`), donc sous RLS. La clé `service_role` sert seulement à la page `/p/[token]` et au script de seed. Jamais côté client, jamais en `NEXT_PUBLIC_`.
5. Page `/p/[token]` :
   - rendue côté serveur. Le serveur hache le token avec HMAC-SHA256 et `SHARE_TOKEN_PEPPER`, puis appelle la RPC `share_snapshot`, exécutable par `service_role` uniquement ;
   - n'expose **jamais** `bottles_a`, les photos, les notes, les montants du Macoua, le total SOA ni l'écart brut ;
   - en-têtes `noindex`, `Cache-Control: no-store` et `Referrer-Policy: no-referrer` ; 404 générique si le token est invalide ou révoqué ; aucun composant client.
6. Tokens de partage : 32 octets aléatoires en base64url, seul le hash est stocké. Ils sont révocables et régénérables, avec un seul lien actif à la fois. Le lien complet n'est affiché qu'une fois.
7. Bucket `bons-livraison` **privé**, politiques `is_admin()`, URLs signées courtes (60 s).
8. Secrets uniquement dans les variables d'environnement (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `SHARE_TOKEN_PEPPER`). Ne jamais commiter de secret ni de `.env*` autre que `.env.example`.
9. Toute nouvelle table : `enable row level security`, `revoke all … from anon, authenticated`, grants minimaux à `authenticated`, politique `(select public.is_admin())`, et un test dans `tests/db/rls.test.ts`.

## Hors périmètre

Paiement en ligne, intégration bancaire, OCR, notifications, comptes pour les beaux-parents, gestion de stock.
