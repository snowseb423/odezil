/**
 * Types du schéma Postgres (format de `supabase gen types typescript`), écrits
 * à la main d'après supabase/migrations. À tenir à jour avec les migrations.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type VarianceTreatmentEnum = "pending" | "impute_to_a" | "impute_to_b" | "split_50_50";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      admin_allowlist: {
        Row: { email: string; created_at: string };
        Insert: { email: string; created_at?: string };
        Update: { email?: string; created_at?: string };
        Relationships: [];
      };
      price_settings: {
        Row: { id: string; unit_price_cents: number; effective_from: string; created_at: string };
        Insert: { id?: string; unit_price_cents: number; effective_from: string; created_at?: string };
        Update: { id?: string; unit_price_cents?: number; effective_from?: string; created_at?: string };
        Relationships: [];
      };
      deliveries: {
        Row: {
          id: string;
          delivery_date: string;
          bottles_a: number;
          bottles_b: number;
          unit_price_cents_applied: number;
          photo_path: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          delivery_date: string;
          bottles_a: number;
          bottles_b: number;
          /** Ignoré : fixé par le trigger deliveries_freeze_unit_price. */
          unit_price_cents_applied?: number;
          photo_path?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      soa_statements: {
        Row: {
          id: string;
          month: string;
          total_billed_cents: number;
          variance_cents: number;
          variance_treatment: VarianceTreatmentEnum;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          month: string;
          total_billed_cents: number;
          variance_cents: number;
          variance_treatment?: VarianceTreatmentEnum;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          month?: string;
          total_billed_cents?: number;
          variance_cents?: number;
          variance_treatment?: VarianceTreatmentEnum;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      repayments: {
        Row: { id: string; repayment_date: string; amount_cents: number; note: string | null; created_at: string };
        Insert: { id?: string; repayment_date: string; amount_cents: number; note?: string | null; created_at?: string };
        Update: never;
        Relationships: [];
      };
      share_links: {
        Row: { id: string; token_hash: string; created_at: string; revoked_at: string | null };
        Insert: { id?: string; token_hash: string; created_at?: string; revoked_at?: string | null };
        Update: { revoked_at?: string | null };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
    };
    Enums: {
      variance_treatment: VarianceTreatmentEnum;
    };
    CompositeTypes: Record<never, never>;
  };
};
