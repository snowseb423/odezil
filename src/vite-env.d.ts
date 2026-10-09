/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Garde-fou d'interface uniquement : la protection réelle est la RLS (is_admin). */
  readonly VITE_ADMIN_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
