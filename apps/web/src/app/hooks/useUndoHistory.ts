// apps/web/src/app/hooks/useUndoHistory.ts
import { useCallback, useMemo, useRef, useState } from "react"
import { APP_CONFIG } from "../config/appConfig"
import { clampNonNegativeInt } from "../domain/guards"

export type UndoHistory = {
  undoStackB64: string[]
  undoBudgetUsed: number
  undoLeft: number
  canUndo: boolean

  setFromRestore: (stack: string[], used: number) => void
  pushSnapshot: (prevPackedProgressB64: string) => void

  /**
   * Pops one snapshot if budget allows.
   * ATOMIC for history state: updates hook state + refs inside the function.
   *
   * Caller MUST NOT call setFromRestore(...) after this.
   */
  popSnapshotBudgeted: () => {
    packedB64: string
    nextStack: string[]
    nextUsed: number
  } | null

  resetKeepBudget: () => void
  resetAll: () => void

  refs: {
    undoStackRef: React.MutableRefObject<string[]>
    undoUsedRef: React.MutableRefObject<number>
  }
}

export function useUndoHistory(params: { budgetPerSession: number }): UndoHistory {
  const [undoStackB64, setUndoStackB64] = useState<string[]>([])
  const [undoBudgetUsed, setUndoBudgetUsed] = useState(0)

  const undoStackRef = useRef<string[]>([])
  const undoUsedRef = useRef(0)

  const syncRefs = useCallback((stack: string[], used: number) => {
    undoStackRef.current = stack
    undoUsedRef.current = used
  }, [])

  const setFromRestore = useCallback(
    (stack: string[], used: number) => {
      const safeStack = (stack ?? [])
        .slice(0, APP_CONFIG.limits.undoStackMax)
        .map((s) => String(s ?? "")) // IMPORTANT: keep empty string as valid snapshot
      const safeUsed = clampNonNegativeInt(used, 0)

      setUndoStackB64(safeStack)
      setUndoBudgetUsed(safeUsed)
      syncRefs(safeStack, safeUsed)
    },
    [syncRefs],
  )

  const pushSnapshot = useCallback(
    (prevPackedProgressB64: string) => {
      const prev = undoStackRef.current
      const item = String(prevPackedProgressB64 ?? "") // keep empty snapshot valid

      // Avoid pushing duplicates (common when progress isn't changing).
      const last = prev.length > 0 ? String(prev[prev.length - 1] ?? "") : null
      if (last !== null && last === item) return

      const next = [...prev, item].slice(-APP_CONFIG.limits.undoStackMax)
      setUndoStackB64(next)
      syncRefs(next, undoUsedRef.current)
    },
    [syncRefs],
  )

  const undoLeft = useMemo(() => {
    const used = clampNonNegativeInt(undoBudgetUsed, 0)
    return Math.max(0, params.budgetPerSession - used)
  }, [params.budgetPerSession, undoBudgetUsed])

  const canUndo = useMemo(
    () => undoLeft > 0 && undoStackB64.length > 0,
    [undoLeft, undoStackB64.length],
  )

  const popSnapshotBudgeted = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length <= 0) return null

    const used = clampNonNegativeInt(undoUsedRef.current, 0)
    const left = Math.max(0, params.budgetPerSession - used)
    if (left <= 0) return null

    const packedB64 = String(stack[stack.length - 1] ?? "") // may be empty: valid "blank page"
    const nextStack = stack.slice(0, -1)
    const nextUsed = used + 1

    // ATOMIC APPLY: update state+refs here.
    setUndoStackB64(nextStack)
    setUndoBudgetUsed(nextUsed)
    syncRefs(nextStack, nextUsed)

    return { packedB64, nextStack, nextUsed }
  }, [params.budgetPerSession, syncRefs])

  const resetKeepBudget = useCallback(() => {
    const used = undoUsedRef.current
    setUndoStackB64([])
    syncRefs([], used)
  }, [syncRefs])

  const resetAll = useCallback(() => {
    setUndoStackB64([])
    setUndoBudgetUsed(0)
    syncRefs([], 0)
  }, [syncRefs])

  return {
    undoStackB64,
    undoBudgetUsed,
    undoLeft,
    canUndo,
    setFromRestore,
    pushSnapshot,
    popSnapshotBudgeted,
    resetKeepBudget,
    resetAll,
    refs: { undoStackRef, undoUsedRef },
  }
}