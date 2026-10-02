"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Vrai une fois React hydraté. Sert à désactiver les boutons qui demandent une
 * confirmation : avant l'hydratation (ou sans JS), un appui enverrait le
 * formulaire directement, sans la confirmation.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
