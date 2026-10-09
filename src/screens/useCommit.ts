import { useCallback } from 'react'
import { CommandError } from '../data/commands.ts'
import { useEngine } from '../data/DataProvider.tsx'
import type { Op } from '../data/ops.ts'
import { useToast } from '../ui/Toaster.tsx'

/**
 * Exécute une intention : construit l'opération (validation du domaine),
 * l'ajoute à la file, et affiche un refus de saisie dans une notification.
 * Renvoie true si l'opération est partie dans la file.
 */
export function useCommit(): (build: () => Op | Op[], success?: { message: string; undo?: () => Op } | null) => Promise<boolean> {
  const engine = useEngine()
  const toast = useToast()
  return useCallback(
    async (build, success) => {
      let ops: Op[]
      try {
        const built = build()
        ops = Array.isArray(built) ? built : [built]
      } catch (error) {
        if (error instanceof CommandError) {
          toast({ tone: 'error', message: error.message })
          return false
        }
        throw error
      }
      for (const op of ops) await engine.commit(op)
      if (success) {
        const undo = success.undo
        toast({
          message: success.message,
          action: undo
            ? {
                label: 'Annuler',
                onAction: () => {
                  try {
                    void engine.commit(undo())
                  } catch (error) {
                    toast({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
                  }
                },
              }
            : undefined,
        })
      }
      return true
    },
    [engine, toast],
  )
}
