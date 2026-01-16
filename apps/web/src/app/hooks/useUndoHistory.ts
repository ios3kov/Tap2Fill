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

/**
 * Defense-in-depth: prevent pathological memory usage if something injects
 * an unexpectedly large "progressB64" string into the undo stack.
 *
 * Keep aligned with snapshot.ts / storage caps.
 */
const MAX_B64_LEN = 200_000

function clampUsed(used: unknown): number {
  return clampNonNegativeInt(used, 0)
}

/**
 * Budget semantics:
 * - budgetPerSession <= 0  => unlimited undo (Infinity)
 * - budgetPerSession > 0   => limited undo (budget - used)
 */
function computeUndoLeft(budgetPerSession: number, used: number): number {
  const budgetRaw = Number.isFinite(budgetPerSession)
    ? Math.trunc(budgetPerSession)
    : 0
  if (budgetRaw <= 0) return Number.POSITIVE_INFINITY

  const budget = clampNonNegativeInt(budgetRaw, 0)
  const u = clampUsed(used)
  return Math.max(0, budget - u)
}

function canUndoNow(stackLen: number, undoLeft: number): boolean {
  return stackLen > 0 && undoLeft > 0
}

function sanitizeSnapshotItem(v: unknown): string | null {
  // IMPORTANT: empty string is valid ("blank page")
  const s = String(v ?? "")
  if (s.length > MAX_B64_LEN) return null
  return s
}

function sanitizeStack(stack: unknown): string[] {
  if (!Array.isArray(stack)) return []

  const out: string[] = []
  const limit = Math.min(stack.length, APP_CONFIG.limits.undoStackMax)

  for (let i = 0; i < limit; i++) {
    const item = sanitizeSnapshotItem(stack[i])
    if (item === null) continue
    out.push(item)
  }

  return out
}

export function useUndoHistory(params: {
  budgetPerSession: number
}): UndoHistory {
  const [undoStackB64, setUndoStackB64] = useState<string[]>([])
  const [undoBudgetUsed, setUndoBudgetUsed] = useState(0)

  const undoStackRef = useRef<string[]>([])
  const undoUsedRef = useRef(0)

  /**
   * Single write-path: keep React state + refs consistent.
   *
   * React setState is async, but hot-path callers read from refs.
   * We update refs synchronously alongside state transitions.
   */
  const apply = useCallback((nextStack: string[], nextUsed: number) => {
    setUndoStackB64(nextStack)
    setUndoBudgetUsed(nextUsed)
    undoStackRef.current = nextStack
    undoUsedRef.current = nextUsed
  }, [])

  const setFromRestore = useCallback(
    (stack: string[], used: number) => {
      const safeStack = sanitizeStack(stack)
      const safeUsed = clampUsed(used)
      apply(safeStack, safeUsed)
    },
    [apply],
  )

  const pushSnapshot = useCallback(
    (prevPackedProgressB64: string) => {
      const prev = undoStackRef.current

      const item = sanitizeSnapshotItem(prevPackedProgressB64)
      if (item === null) return

      const last = prev.length > 0 ? String(prev[prev.length - 1] ?? "") : null
      if (last !== null && last === item) return

      const nextStack = [...prev, item].slice(-APP_CONFIG.limits.undoStackMax)
      apply(nextStack, undoUsedRef.current)
    },
    [apply],
  )

  const undoLeft = useMemo(() => {
    return computeUndoLeft(params.budgetPerSession, undoBudgetUsed)
  }, [params.budgetPerSession, undoBudgetUsed])

  const canUndo = useMemo(() => {
    return canUndoNow(undoStackB64.length, undoLeft)
  }, [undoLeft, undoStackB64.length])

  const popSnapshotBudgeted = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length <= 0) return null

    const used = clampUsed(undoUsedRef.current)
    const left = computeUndoLeft(params.budgetPerSession, used)
    if (left <= 0) return null

    const packedB64 = String(stack[stack.length - 1] ?? "")
    const nextStack = stack.slice(0, -1)

    // We still increment "used" even in unlimited mode: useful for analytics/debug,
    // and keeps persisted snapshots consistent.
    const nextUsed = used + 1

    apply(nextStack, nextUsed)
    return { packedB64, nextStack, nextUsed }
  }, [params.budgetPerSession, apply])

  const resetKeepBudget = useCallback(() => {
    const used = clampUsed(undoUsedRef.current)
    apply([], used)
  }, [apply])

  const resetAll = useCallback(() => {
    apply([], 0)
  }, [apply])

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
