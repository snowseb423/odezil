// Prépare le compte administrateur. Usage : npm run seed:admin   (lit .env.local s'il existe)
// Nécessite NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et ADMIN_EMAIL.
//
// 1. Insère ADMIN_EMAIL (en minuscules) dans public.admin_allowlist (utilisée par is_admin()).
// 2. Crée le compte admin dans Supabase Auth, email déjà confirmé et SANS mot de passe.
//    Le compte existe ainsi avant toute inscription : personne ne peut le pré-créer avec
//    son propre mot de passe. La première connexion Google s'y rattache automatiquement
//    (même adresse, vérifiée par Google). Idempotent : sans effet si le compte existe.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();

if (!url || !serviceKey || !email) {
  console.error(
    "Variables manquantes : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et ADMIN_EMAIL sont requises.",
  );
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`ADMIN_EMAIL invalide : « ${email} »`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error: allowlistError } = await supabase
  .from("admin_allowlist")
  .upsert({ email }, { onConflict: "email", ignoreDuplicates: true });

if (allowlistError) {
  console.error(`Échec (admin_allowlist) : ${allowlistError.message}`);
  process.exit(1);
}
console.log(`OK : ${email} est dans admin_allowlist.`);

const { error: userError } = await supabase.auth.admin.createUser({ email, email_confirm: true });

if (userError && userError.code !== "email_exists" && userError.code !== "user_already_exists") {
  console.error(`Échec (compte Auth) : ${userError.message}`);
  process.exit(1);
}
console.log(
  userError
    ? `OK : le compte ${email} existe déjà dans Supabase Auth.`
    : `OK : compte ${email} créé (email confirmé, sans mot de passe).`,
);
