// apps/web/src/app/undo/undo.ts
/**
 * Undo model (pure, deterministic, UI-agnostic).
 *
 * Contract:
 * - We store an unbounded stack of actions (no trimming here).
 * - Each action is a reversible change for ONE region index.
 * - Color indices are integers in [0..paletteLen-1] or -1 for "empty/unfilled".
 *
 * Notes:
 * - This module does NOT mutate progress bytes or DOM.
 * - UI/Domain layer decides how to map regionId -> regionIndex and apply color changes.
 */

export type RegionId = string

/**
 * -1 represents "no fill".
 * Non-negative integers represent palette indices.
 */
export type ColorIndex = number

export type UndoAction = Readonly<{
  regionId: RegionId
  prevColorIdx: ColorIndex
  nextColorIdx: ColorIndex
  atMs: number
}>

export type UndoStack = ReadonlyArray<UndoAction>

export type UndoResult =
  | Readonly<{ ok: true; stack: UndoStack; action: UndoAction }>
  | Readonly<{ ok: false; stack: UndoStack; reason: "EMPTY_STACK" }>

function nowMs(): number {
  return Date.now()
}

function safeTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/**
 * Validate a color index with a palette length.
 * Allows -1 (empty). Clamps everything else into [0..paletteLen-1] if paletteLen > 0.
 * If paletteLen <= 0, returns -1 (empty) for safety.
 */
export function normalizeColorIndex(
  idx: unknown,
  paletteLen: number,
): ColorIndex {
  const len = toInt(paletteLen)
  const i = toInt(idx)

  if (len <= 0) return -1
  if (i === -1) return -1
  if (i < 0) return 0
  if (i >= len) return len - 1
  return i
}

/**
 * Normalize a region id into a safe key.
 * (We keep it permissive but bounded; strict patterns live in SVG/catal og layers.)
 */
export function normalizeRegionId(regionId: unknown): RegionId | null {
  const s = safeTrim(regionId)
  if (!s) return null
  if (s.length > 64) return null
  // Conservative allowlist; extend if needed.
  if (!/^[a-zA-Z0-9:_-]+$/.test(s)) return null
  return s
}

/**
 * Whether there is anything to undo.
 */
export function canUndo(stack: UndoStack): boolean {
  return Array.isArray(stack) && stack.length > 0
}

/**
 * Push an undo action.
 *
 * Rules:
 * - If regionId is invalid -> returns original stack.
 * - If (prev == next) -> no-op, returns original stack.
 * - Returns a NEW array (persistent/immutable style).
 *
 * Performance:
 * - Unbounded stack by design (caller may snapshot/compact if desired).
 */
export function pushAction(
  stack: UndoStack,
  action: {
    regionId: unknown
    prevColorIdx: unknown
    nextColorIdx: unknown
    paletteLen: number
    atMs?: number
  },
): UndoStack {
  const base = Array.isArray(stack) ? stack : []

  const id = normalizeRegionId(action.regionId)
  if (!id) return base

  const prev = normalizeColorIndex(action.prevColorIdx, action.paletteLen)
  const next = normalizeColorIndex(action.nextColorIdx, action.paletteLen)

  if (prev === next) return base

  const atMs =
    typeof action.atMs === "number" && Number.isFinite(action.atMs)
      ? Math.trunc(action.atMs)
      : nowMs()

  const entry: UndoAction = Object.freeze({
    regionId: id,
    prevColorIdx: prev,
    nextColorIdx: next,
    atMs,
  })

  // Unbounded by design
  return [...base, entry]
}

/**
 * Pop the last action and return it along with the remaining stack.
 * Pure (does not mutate).
 */
export function undoOne(stack: UndoStack): UndoResult {
  const base = Array.isArray(stack) ? stack : []
  if (base.length === 0)
    return { ok: false, stack: base, reason: "EMPTY_STACK" }

  const action = base[base.length - 1]
  const nextStack = base.slice(0, -1)

  return { ok: true, stack: nextStack, action }
}
