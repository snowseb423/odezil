import "server-only";
import { parseSnapshot, type CardinalView } from "@/lib/cardinal-statement";
import { shareTokenPepper } from "@/lib/env";
import { hashShareToken, isWellFormedShareToken } from "@/lib/share-token";
import { createServiceClient } from "@/lib/supabase/service";

type SnapshotRpc = (tokenHash: string) => Promise<unknown>;

/**
 * Lecture des données Cardinal pour un token de partage, à partir d'une
 * fonction RPC injectée (testable sans Supabase).
 */
export async function loadCardinalView(token: string, rpc: SnapshotRpc, pepper: string): Promise<CardinalView | null> {
  if (!isWellFormedShareToken(token)) return null;
  return parseSnapshot(await rpc(hashShareToken(token, pepper)));
}

/** Données de la page /p/[token] ; `null` si le token est invalide ou révoqué. */
export async function getCardinalView(token: string): Promise<CardinalView | null> {
  const supabase = createServiceClient();
  return loadCardinalView(
    token,
    async (tokenHash) => {
      const { data, error } = await supabase.rpc("share_snapshot", { p_token_hash: tokenHash });
      if (error) throw new Error(`share_snapshot : ${error.message}`);
      return data;
    },
    shareTokenPepper(),
  );
}
