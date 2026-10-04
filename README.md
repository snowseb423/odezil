# EauPartagée

PWA mobile-first pour suivre les livraisons de bonbonnes d'eau **Odezil** partagées entre deux foyers :

- **Macoua** (foyer A) : l'administrateur, seul utilisateur. Il avance les paiements à Odezil.
- **Cardinal** (foyer B) : les beaux-parents. Ils remboursent hors application et consultent leur relevé via un **lien privé en lecture seule**.

Ce que fait l'application :

- saisie d'une livraison en quelques secondes, d'après le bon manuscrit (photo facultative) ;
- rapprochement avec le relevé mensuel (SOA) et traitement des écarts ;
- suivi des remboursements et calcul du solde du Cardinal ;
- message récapitulatif prêt pour WhatsApp ;
- historique mensuel avec export CSV.

Elle ne gère aucun paiement en ligne.

## Sommaire

1. [Stack](#stack)
2. [Démarrage en local](#démarrage-en-local)
3. [Créer le projet Supabase et appliquer les migrations](#1-créer-le-projet-supabase-et-appliquer-les-migrations)
4. [Configurer Google OAuth](#2-configurer-google-oauth)
5. [URLs de redirection Supabase](#3-urls-de-redirection-supabase)
6. [Code et lien magique par email](#4-code-et-lien-magique-par-email)
7. [Variables d'environnement](#5-variables-denvironnement)
8. [Autoriser l'adresse admin](#6-autoriser-ladresse-admin)
9. [Verrouiller les inscriptions](#7-verrouiller-les-inscriptions)
10. [Déployer sur Vercel](#8-déployer-sur-vercel)
11. [Dépannage](#dépannage)
12. [Utilisation](#utilisation)
13. [Tests](#tests)
14. [Sécurité](#sécurité)
15. [Choix de conception](#choix-de-conception)

## Stack

- Next.js 16 (App Router), TypeScript strict, Tailwind CSS 4, PWA installable.
- Supabase : Postgres (RLS), Auth (Google + lien magique), Storage (bucket privé).
- Vitest. Les tests base de données tournent sur PGlite (Postgres en WASM), sans Docker.
- Vercel, via l'intégration GitHub.

## Démarrage en local

```bash
npm install
cp .env.example .env.local   # puis renseigner les valeurs (voir § 5)
npm run dev                  # http://localhost:3000
```

Commandes utiles :

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run lint` | ESLint |
| `npm run typecheck` | vérification TypeScript |
| `npm test` | tests Vitest (calculs, auth, RLS, isolation) |
| `npm run build` | build de production |
| `npm run seed:admin` | ajoute `ADMIN_EMAIL` à `admin_allowlist` |

---

## 1. Créer le projet Supabase et appliquer les migrations

1. Sur [supabase.com](https://supabase.com/dashboard), créez un projet. Choisissez une région proche (ex. `ap-south-1`) et notez le mot de passe de la base.
2. Récupérez la référence du projet `<ref-projet>` : c'est le sous-domaine de `https://<ref-projet>.supabase.co`.
3. Appliquez les migrations de `supabase/migrations/`, au choix :
   - **Avec la CLI** (recommandé) :
     ```bash
     npx supabase login
     npx supabase link --project-ref <ref-projet>
     npx supabase db push
     ```
   - **Avec l'éditeur SQL** du dashboard : exécutez chaque fichier de `supabase/migrations/` **dans l'ordre** des noms.

Les migrations créent :

- les tables, avec le RLS activé partout ;
- la fonction `is_admin()` ;
- le trigger qui fige le prix de chaque livraison ;
- le bucket **privé** `bons-livraison` et ses politiques ;
- le hook d'inscription (optionnel, voir § 7) ;
- la fonction `share_snapshot` utilisée par la page du Cardinal.

Un prix initial de **Rs 240** est enregistré, applicable à toutes les dates. Il se modifie dans *Réglages*.

## 2. Configurer Google OAuth

Dans la [Google Cloud Console](https://console.cloud.google.com/) :

1. Créez un projet, ou réutilisez-en un.
2. Configurez l'**écran de consentement OAuth** (*APIs & Services > OAuth consent screen*) :
   - type **External** ;
   - nom de l'application, email de support ;
   - champs d'application `openid`, `email` et `profile`.
   
   Tant que l'application reste en mode « Testing », ajoutez votre adresse dans *Test users*. Vous pouvez aussi la publier : seuls les champs d'application de base sont utilisés.
3. Créez l'identifiant (*APIs & Services > Credentials > Create credentials > OAuth client ID*) :
   - type d'application : **Web application** ;
   - **Authorized redirect URIs** : `https://<ref-projet>.supabase.co/auth/v1/callback`.
4. Copiez le **Client ID** et le **Client Secret**.

Puis dans Supabase (*Authentication > Sign In / Providers > Google*) :

5. Activez **Google**.
6. Collez le **Client ID** et le **Client Secret**, puis enregistrez.

## 3. URLs de redirection Supabase

Dans Supabase (*Authentication > URL Configuration*) :

- **Site URL** : l'URL de production Vercel, ex. `https://eaupartagee.vercel.app`.
- **Redirect URLs** : uniquement des URLs **exactes**, une par ligne :
  ```
  https://eaupartagee.vercel.app/auth/callback
  http://localhost:3000/auth/callback
  ```

L'application envoie toujours `https://<hôte>/auth/callback` comme URL de retour. Supabase refuse toute URL absente de cette liste.

> **N'ajoutez jamais de joker** du type `https://*.vercel.app/**` ou `https://*-<équipe>.vercel.app/**`. Chez Supabase, le `*` accepte aussi les tirets, et n'importe qui peut créer un projet Vercel nommé `x-<équipe>`. Un tiers obtiendrait alors un hôte accepté et pourrait y recevoir le code de connexion Google ou le lien magique de l'admin, c'est-à-dire un accès aux données de production.
>
> Pour tester la connexion sur une preview, deux options :
> - ajoutez **temporairement** l'URL exacte de la branche (`https://eaupartagee-git-<branche>-<slug>.vercel.app/auth/callback`), puis retirez-la ;
> - ou faites pointer l'environnement *Preview* de Vercel vers un projet Supabase distinct.
>
> Sans cela, la connexion échoue sur les previews : Supabase renvoie vers la Site URL. C'est voulu.

## 4. Code et lien magique par email

L'email de connexion sert de secours si Google est indisponible, et c'est **la seule méthode dans l'app installée sur l'écran d'accueil d'un iPhone**. iOS y ouvre Google dans une vue Safari séparée, dont la session est perdue à la fermeture de l'app ; un lien ouvert depuis Mail se connecte dans Safari, pas dans l'app. La page de connexion masque donc Google en mode app installée et propose le code à 6 chiffres, saisi sans quitter l'app.

L'email n'est envoyé qu'à `ADMIN_EMAIL` et uniquement pour un compte **déjà existant** (créé par `npm run seed:admin`, voir § 6).

Pour ne pas révéler l'adresse admin, l'application l'envoie sans cookie (flux `token_hash`). Il faut donc **remplacer le modèle d'email** dans *Authentication > Emails > Magic Link*, en gardant le code `{{ .Token }}` :

```html
<h2>Connexion à EauPartagée</h2>
<p>Votre code : <strong style="font-size:24px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>Ou, depuis un navigateur : <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">se connecter</a></p>
<p>Ce code et ce lien expirent rapidement et ne servent qu'une fois.</p>
```

`{{ .RedirectTo }}` vaut `https://<hôte>/auth/callback`. Le lien fonctionne même s'il est ouvert depuis l'application mail du téléphone, mais connecte alors Safari, pas l'app installée. Avec le modèle par défaut, ni le code ni le lien ne permettraient de se connecter.

## 5. Variables d'environnement

| Variable | Où la trouver | Exposée au navigateur |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API (Project URL) | oui |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase > API Keys : clé `anon` ou `sb_publishable_…` | oui (publique par nature) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > API Keys : clé `service_role` ou `sb_secret_…` | **jamais** |
| `ADMIN_EMAIL` | votre adresse Google | non |
| `SHARE_TOKEN_PEPPER` | `openssl rand -base64 32` | non |

- **En local** : dans `.env.local`, jamais commité grâce à `.gitignore`.
- **Sur Vercel** : *Project > Settings > Environment Variables*. Ajoutez les 5 variables pour **Production** et **Preview**, puis **redéployez** : une variable ajoutée ou modifiée n'est prise en compte qu'au déploiement suivant (*Deployments > ⋯ > Redeploy*).

**Intégration Vercel ↔ Supabase.** Si vous avez relié les deux depuis Vercel, l'intégration crée déjà les variables Supabase. L'application accepte les deux nommages : `NEXT_PUBLIC_SUPABASE_ANON_KEY` ou `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, et `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`. En revanche, **`ADMIN_EMAIL` et `SHARE_TOKEN_PEPPER` ne sont jamais créées par l'intégration** : ajoutez-les vous-même.

Saisissez `ADMIN_EMAIL` sans guillemets ni espaces (`vous@gmail.com`). Si une variable manque ou est invalide, la page de connexion l'indique dans un encadré (nom de la variable seulement, jamais sa valeur).

Changer `SHARE_TOKEN_PEPPER` invalide le lien du Cardinal : il faudra en générer un nouveau.

## 6. Autoriser l'adresse admin

Deux contrôles indépendants protègent l'accès :

- **côté application** : la session doit porter `ADMIN_EMAIL`, avec une adresse confirmée ;
- **côté base** : la table `admin_allowlist`, utilisée par `is_admin()` dans toutes les politiques RLS.

Lancez le script de préparation **avant toute première connexion** :

```bash
# avec NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et ADMIN_EMAIL dans .env.local
npm run seed:admin
```

Il fait deux choses :

1. Il ajoute `ADMIN_EMAIL`, en minuscules, à `admin_allowlist`.
2. Il crée votre compte dans Supabase Auth, **adresse confirmée et sans mot de passe**. Personne ne peut ainsi créer ce compte avant vous avec son propre mot de passe. Votre première connexion Google s'y rattache automatiquement.

Le script est idempotent : vous pouvez le relancer sans risque.

À défaut, vous pouvez passer par le dashboard :

- l'éditeur SQL : `insert into public.admin_allowlist (email) values (lower('votre.adresse@gmail.com'));` ;
- puis *Authentication > Users > Add user > Create new user* : votre adresse, **sans mot de passe**, avec « Auto Confirm User ».

Connectez-vous ensuite avec **« Se connecter avec Google »**.

## 7. Verrouiller les inscriptions

Avec Google OAuth, **n'importe quel compte Google** peut obtenir une session Supabase. Le RLS (`is_admin()`) et le contrôle serveur l'empêchent déjà de lire ou d'écrire quoi que ce soit. En plus, empêchez la création de comptes :

1. *Authentication > Sign In / Providers* : désactivez **Allow new users to sign up**, une fois votre première connexion Google réussie. Votre compte existe : Google et le lien magique continuent de fonctionner pour vous. Toute autre tentative affiche « Accès non autorisé ».
2. Facultatif, utile si vous gardez les inscriptions ouvertes : activez le hook (*Authentication > Hooks > Before User Created > Postgres*, fonction `public.hook_before_user_created`). Il n'autorise la création d'un compte que **via Google** et pour une adresse présente dans `admin_allowlist`. Toute inscription par email ou mot de passe est refusée.
3. Laissez **Confirm email** activé (*Authentication > Sign In / Providers > Email*).

N'utilisez jamais de mot de passe. Les sessions ouvertes par mot de passe (claim `amr` du jeton) sont refusées par l'application et par le RLS, même sur votre adresse.

## 8. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com/new), choisissez **Import Git Repository** et sélectionnez ce dépôt GitHub. Le framework **Next.js** est détecté automatiquement.
2. Avant le premier déploiement, ajoutez les variables d'environnement du § 5.
3. Dans *Settings > Git*, la **Production Branch** est `main` :
   - chaque push sur `main` déploie la production ;
   - chaque pull request reçoit un déploiement de preview. La connexion n'y fonctionne pas par défaut (§ 3).
4. Laissez activée la **Deployment Protection** (*Settings > Deployment Protection > Vercel Authentication*). Les previews utilisent la même base Supabase que la production : seules les personnes de votre équipe Vercel doivent pouvoir les ouvrir.
5. Reportez l'URL de production dans la **Site URL** de Supabase (§ 3).

Après le déploiement, sur votre téléphone, ouvrez l'URL de production puis faites **« Ajouter à l'écran d'accueil »** pour installer la PWA.

### Vérification après déploiement

- [ ] Connexion avec votre compte Google : accès à l'accueil.
- [ ] Connexion avec un **autre** compte Google : message « Accès non autorisé », aucune donnée visible.
- [ ] Lien magique (« Problème avec Google ? ») reçu et fonctionnel depuis le téléphone.
- [ ] Saisie d'une livraison avec photo, puis photo visible depuis l'historique.
- [ ] Lien Cardinal généré (*Réglages*), ouvert en navigation privée : relevé visible. Après révocation : page 404.

## Dépannage

| Symptôme | Cause probable | Correction |
| --- | --- | --- |
| Encadré « Configuration du serveur incomplète » sur la page de connexion | Variable d'environnement manquante ou invalide (l'encadré la nomme) | L'ajouter sur Vercel (§ 5), puis redéployer |
| Erreur 500 au retour de Google, puis « La connexion a échoué ou le lien a expiré » (versions antérieures) | `ADMIN_EMAIL` absente côté serveur : le code Google était consommé, puis la page plantait | Ajouter `ADMIN_EMAIL` sur Vercel, puis redéployer |
| « Accès non autorisé » avec votre propre compte | `ADMIN_EMAIL` ne correspond pas à l'adresse du compte Google choisi | Corriger `ADMIN_EMAIL` ou choisir le bon compte Google |
| Connecté, mais encadré « La base de données ne reconnaît pas ce compte » et données vides | Adresse absente de `admin_allowlist` (ou en majuscules), ou compte non confirmé | `npm run seed:admin` (§ 6) |
| Retour sur la page de connexion sans message après Google | L'URL `…/auth/callback` n'est pas dans les Redirect URLs : Supabase renvoie vers la Site URL | § 3 |
| Page Google « redirect_uri_mismatch » | URI de redirection de l'ID client Google incorrecte | `https://<ref-projet>.supabase.co/auth/v1/callback` (§ 2) |
| « Supabase n'a pas pu finaliser la connexion Google » ; dans les journaux Supabase (*Logs > Auth*) : `Unable to exchange external code` | Secret client Google faux, ou secret d'un autre client que l'ID saisi | Recopier l'ID et le secret du même client Google dans Supabase (§ 2) |
| Même message, journaux Supabase : `Database error saving new user` | Trigger sur `auth.users` ou hook en erreur (import SQL étranger au projet) | Supprimer le trigger ou désactiver le hook ; `npm run seed:admin` évite la création de compte au premier login |

Le détail technique d'une erreur figure dans les journaux Vercel (*Project > Logs*), jamais à l'écran.

---

## Utilisation

- **Accueil** : solde du Cardinal, dernières livraisons, bouton « Nouvelle livraison ».
- **Nouvelle livraison** :
  - date du jour par défaut ;
  - compteurs ± pré-remplis avec la livraison précédente ;
  - montants affichés en direct ;
  - photo du bon (appareil photo ou fichier) et note, facultatives.
- **SOA** : choisissez le mois et saisissez le total du relevé Odezil. L'écart avec les livraisons saisies s'affiche.
  - S'il est non nul, choisissez son traitement : Macoua, Cardinal, 50/50 ou « En attente ».
  - L'écart est figé à l'enregistrement. Si une livraison du mois change ensuite, un avertissement invite à revalider.
- **Remboursements** : date et montant, partiel ou groupé.
- **Message récap** : texte prêt pour WhatsApp, avec bouton « Copier ».
- **Historique** : vue par mois (livraisons, totaux, écart, statut) et export CSV (`livraisons` ou `mensuel`, au format Excel FR).
- **Réglages** :
  - prix unitaire avec date d'effet ;
  - lien du Cardinal (le lien complet n'est affiché **qu'une fois** ; on peut le révoquer ou le régénérer) ;
  - déconnexion.

## Tests

```bash
npm test
```

| Fichier | Couverture |
| --- | --- |
| `tests/calculations.test.ts` | part par livraison, prix selon la date d'effet, écart SOA positif, négatif et nul, les 3 traitements + « en attente », solde après remboursements partiels et groupés, arrondis au centime |
| `tests/money-dates.test.ts` | format `Rs 1 200,00`, saisie des montants sans flottants, fuseau de Maurice |
| `tests/db/rls.test.ts` | **isolation (b)** : anon, compte Google non autorisé, JWT falsifié, email non confirmé, session par mot de passe → aucune lecture ni écriture sur les tables et le bucket. Suite exécutée avec les droits par défaut de Supabase **et** en mode strict (projet sans droits par défaut) |
| `tests/db/share-isolation.test.tsx` | **isolation (a)** : la RPC et le HTML de la page Cardinal ne contiennent aucune donnée du Macoua, aucune photo ni note ; token révoqué → 404 |
| `tests/auth.test.ts` | callback OAuth, proxy, lien magique : un compte non autorisé est déconnecté |
| `tests/db/schema.test.ts`, `crosscheck.test.ts` | prix figé par trigger, contraintes, concordance SQL ↔ TypeScript |
| autres | validation des saisies, actions serveur, message récap, CSV |

Les tests base de données appliquent les vraies migrations à un Postgres 16 embarqué (PGlite). `tests/db/supabase-stubs.sql` y imite les schémas `auth` et `storage` et les rôles de Supabase. Avant une migration importante, vous pouvez aussi la valider sur une base Supabase réelle : `npx supabase db reset` en local avec Docker, ou une branche Supabase.

## Sécurité

- **RLS sur toutes les tables**, aucun droit pour `anon` (ni sur les futures fonctions). Les politiques de `authenticated` exigent `is_admin()` :
  - email du JWT présent dans `admin_allowlist` ;
  - email lié à l'utilisateur `auth.uid()` et confirmé ;
  - session non ouverte par mot de passe.
- **Compte admin pré-créé** par `npm run seed:admin` : confirmé et sans mot de passe, pour empêcher toute prise de contrôle anticipée.
- **Lien magique** envoyé sans cookie et après la réponse : la page de connexion ne révèle pas quelle adresse est autorisée.
- **Triple barrière côté application** : proxy, layout admin et chaque Server Action appellent `requireAdmin()`. Un compte non autorisé est déconnecté immédiatement.
- **Page Cardinal `/p/<token>`** :
  - token de 32 octets aléatoires (base64url), stocké uniquement sous forme de hash HMAC-SHA256 avec `SHARE_TOKEN_PEPPER` ;
  - rendue côté serveur, sans JavaScript client, via la RPC `share_snapshot`, exécutable uniquement par `service_role` et qui ne renvoie que les données du Cardinal ;
  - en-têtes `Cache-Control: no-store`, `X-Robots-Tag: noindex` et `Referrer-Policy: no-referrer` ;
  - 404 générique si le token est invalide ou révoqué.
- **Photos** : bucket privé, accessible à l'admin seulement, affichées via une URL signée de 60 s.
- **Secrets** uniquement dans les variables d'environnement. La clé `service_role` n'est jamais envoyée au navigateur.

## Choix de conception

- Montants en **centimes entiers** partout. Le prix appliqué est **figé** dans chaque livraison par un trigger : changer le prix n'altère jamais le passé.
- Totaux et soldes sont **calculés**, jamais stockés, par une seule implémentation testée : `lib/calculations.ts`. Seul l'écart SOA est figé à l'enregistrement.
- **Partage 50/50** d'un écart impair : le Cardinal paie la moitié tronquée au centime, le centime restant est pour le Macoua.
- Mois SOA = mois civil de la date de livraison. « Aujourd'hui » = fuseau `Indian/Mauritius`.
- Livraisons et remboursements ne se modifient pas : on les supprime puis on les ressaisit.
- **Message récap du mois M** :
  - total à régler = charges jusqu'à la fin de M − tous les remboursements reçus ;
  - solde antérieur = total − montant du mois (affiché seulement s'il est non nul).
- Un seul lien Cardinal actif à la fois.
- Le service worker ne met rien en cache : pas de mode hors-ligne.
