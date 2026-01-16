// apps/web/src/app/App.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getInitData, isTma, tmaBootstrap } from "../lib/tma"
import {
  getMeState,
  putMeState,
  type MeState,
  hasTelegramInitData,
} from "../lib/api"
import {
  deletePageSnapshot,
  loadLastPageId,
  loadPageSnapshot,
  saveLastPageId,
  savePageSnapshot,
  type PageSnapshotV2,
} from "../local/snapshot"
import {
  clearPendingMeState,
  enqueueMeState,
  loadPendingMeState,
} from "../local/outbox"

import demoSvg from "./demoPage.svg?raw"
import {
  DEFAULT_PALETTE,
  applyFillsToContainer,
  safeColorIndex,
  type FillMap,
} from "./coloring"
import {
  applyFillToRegion,
  hitTestRegionAtPoint,
  mountSvgIntoHost,
  ensureSvgPointerPolicyStyle,
  type MountResult,
} from "./svgTapToFill"

import {
  attachZoomPan,
  type Transform as ZoomPanTransform,
} from "./viewport/zoomPan"
import "./viewport/zoomPan.css"

import Gallery from "./ui/Gallery"
import "./ui/gallery.css"

import { ConfirmModal } from "./ui/ConfirmModal"
import { CompletionReward } from "./ui/CompletionReward"
import "./ui/page.css"

import { decodeProgressB64ToFillMap } from "./progress/pack"

import "./svgTapToFill.css"

type Route = { name: "gallery" } | { name: "page"; pageId: string }

const DEMO_PAGE_ID = "page_demo_1"
const DEMO_CONTENT_HASH = "demo_hash_v1"

// Demo page metadata (Stage 3: static; later comes from catalog/API)
const DEMO_REGIONS_COUNT = 240 // must match actual page
const DEMO_PALETTE: readonly string[] = DEFAULT_PALETTE

const DEMO_REGION_ORDER: readonly string[] = Array.from(
  { length: DEMO_REGIONS_COUNT },
  (_, i) => `R${String(i + 1).padStart(3, "0")}`,
)

// Undo policy (Stage 3)
const UNDO_BUDGET_PER_SESSION = 5

type UnknownRecord = Record<string, unknown>

function asRecord(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" ? (v as UnknownRecord) : null
}

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function applyTransformStyle(el: HTMLElement, t: ZoomPanTransform): void {
  el.style.transform = `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.scale})`
}

function normalizePageId(pageId: unknown): string | null {
  const s = typeof pageId === "string" ? pageId.trim() : ""
  if (!s) return null
  if (s.length > 64) return null
  if (!/^[a-zA-Z0-9:_-]+$/.test(s)) return null
  return s
}

function isFiniteNonNegativeInt(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v)
  )
}

function clampNonNegativeInt(v: unknown, fallback = 0): number {
  return isFiniteNonNegativeInt(v) ? v : fallback
}

function safeArrayOfStrings(v: unknown, maxLen = 1000): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (out.length >= maxLen) break
    if (typeof x === "string" && x.trim()) out.push(x.trim())
  }
  return out
}

function sanitizeFillMap(input: unknown, maxEntries = 20000): FillMap {
  const rec = asRecord(input)
  if (!rec) return {}
  const out: FillMap = {}
  let n = 0
  for (const [k, v] of Object.entries(rec)) {
    if (n >= maxEntries) break
    if (typeof k !== "string" || k.length === 0 || k.length > 64) continue
    if (typeof v !== "string" || v.length === 0 || v.length > 64) continue
    // Only allow regionId-like keys (we use R### pattern in demo)
    if (!/^R\d{3}$/.test(k)) continue
    out[k] = v
    n++
  }
  return out
}

/**
 * Snapshot helpers
 * - Stage 3+ source of truth is packed progress (progressB64 + meta).
 * - FillMap is kept only in live UI state; v2 snapshot does not persist it.
 */
function buildSnapshot(params: {
  clientRev: number
  demoCounter: number
  pageId: string
  contentHash: string
  paletteIdx: number
  progressB64: string
  regionsCount: number
  paletteLen: number
  undoStackB64: string[]
  undoUsed: number
}): PageSnapshotV2 {
  return {
    schemaVersion: 2,
    pageId: params.pageId,
    contentHash: params.contentHash,
    clientRev: clampNonNegativeInt(params.clientRev, 0),
    demoCounter: clampNonNegativeInt(params.demoCounter, 0),
    paletteIdx: clampNonNegativeInt(params.paletteIdx, 0),

    progressB64: String(params.progressB64 ?? ""),
    regionsCount: clampNonNegativeInt(params.regionsCount, 0),
    paletteLen: clampNonNegativeInt(params.paletteLen, 0),

    undoStackB64: safeArrayOfStrings(params.undoStackB64, 64),
    undoBudgetUsed: clampNonNegativeInt(params.undoUsed, 0),

    updatedAtMs: Date.now(),
  }
}

export default function App() {
  const [out, setOut] = useState("idle")
  const [tick, setTick] = useState(0)

  // Routing
  const [route, setRoute] = useState<Route>({ name: "gallery" })

  // Local-first state
  const [clientRev, setClientRev] = useState(0)
  const [demoCounter, setDemoCounter] = useState(0)
  const [lastPageId, setLastPageId] = useState<string | null>(null)

  // Visibility: server
  const [serverState, setServerState] = useState<MeState | null>(null)

  // Coloring UI state (LOCAL-FIRST persisted)
  const [paletteIdx, setPaletteIdx] = useState(0)
  const [fills, setFills] = useState<FillMap>({})
  const [lastTap, setLastTap] = useState<string>("none")

  // Packed progress (forward compatible storage)
  const [progressB64, setProgressB64] = useState<string>("")
  const progressB64Ref = useRef<string>("")

  // Undo (stack of packed progress snapshots)
  const [undoStackB64, setUndoStackB64] = useState<string[]>([])
  const [undoBudgetUsed, setUndoBudgetUsed] = useState(0)

  // Zoom/Pan state
  const [transform, setTransform] = useState<ZoomPanTransform>({
    scale: 1,
    tx: 0,
    ty: 0,
  })
  const [isGesturing, setIsGesturing] = useState(false)

  // Page UX: confirm + reward overlay
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [rewardOpen, setRewardOpen] = useState(false)
  const rewardDismissedRef = useRef(false)

  const svgHostRef = useRef<HTMLDivElement | null>(null)
  const zoomContainerRef = useRef<HTMLDivElement | null>(null)
  const zoomContentRef = useRef<HTMLDivElement | null>(null)

  // Batched sync refs
  const flushTimerRef = useRef<number | null>(null)
  const flushingRef = useRef(false)

  // Stable refs for async flows
  const clientRevRef = useRef(0)
  const demoCounterRef = useRef(0)
  const paletteIdxRef = useRef(0)
  const fillsRef = useRef<FillMap>({})
  const undoStackRef = useRef<string[]>([])
  const undoUsedRef = useRef(0)
  const isGesturingRef = useRef(false)

  const activeTouchIdsRef = useRef<Set<number>>(new Set())

  const onCanvasPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return
    activeTouchIdsRef.current.add(e.pointerId)
  }

  const onCanvasPointerUpCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return
    // IMPORTANT: do not delete pointerId here; onPointerUp needs it for its debounce checks.
  }

  const onCanvasPointerCancelCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return
    // Pointer got cancelled: clear just in case.
    // IMPORTANT: do not delete pointerId here; onPointerUp uses it for debounce checks.
  }

  useEffect(() => {
    // Safety: if zoom/pan reports gesture ended, clear any stuck touch ids (iOS/Telegram can drop pointerup/cancel).
    if (!isGesturing) activeTouchIdsRef.current.clear()
  }, [isGesturing])

  useEffect(() => {
    clientRevRef.current = clientRev
  }, [clientRev])

  useEffect(() => {
    demoCounterRef.current = demoCounter
  }, [demoCounter])

  useEffect(() => {
    paletteIdxRef.current = paletteIdx
  }, [paletteIdx])

  useEffect(() => {
    fillsRef.current = fills
  }, [fills])

  useEffect(() => {
    progressB64Ref.current = progressB64
  }, [progressB64])

  useEffect(() => {
    undoStackRef.current = undoStackB64
  }, [undoStackB64])

  useEffect(() => {
    undoUsedRef.current = undoBudgetUsed
  }, [undoBudgetUsed])

  useEffect(() => {
    isGesturingRef.current = isGesturing
  }, [isGesturing])

  useEffect(() => {
    const cleanup = tmaBootstrap()
    ensureSvgPointerPolicyStyle()

    const id = window.setInterval(() => setTick((t) => t + 1), 250)
    window.setTimeout(() => window.clearInterval(id), 3000)

    return () => {
      window.clearInterval(id)
      cleanup?.()
    }
  }, [])

  // tick is used purely to force re-render during first seconds; we just read initData directly.
  void tick
  const initDataLen = getInitData().length

  const runtimeLabel = isTma() ? "Telegram Mini App" : "Web (standalone)"
  const canCallServer = hasTelegramInitData()

  // Gallery progress placeholder (Stage 3 demo: empty map; later: derive from snapshots per catalog item)
  const progressByPageId = useMemo<
    Record<string, { pageId: string; ratio: number; completed: boolean }>
  >(() => ({}), [])

  const persistSnapshotNow = useCallback(
    async (params: {
      nextClientRev: number
      nextDemoCounter: number
      nextPaletteIdx: number
      nextProgressB64: string
      nextUndoStackB64: string[]
      nextUndoUsed: number
    }): Promise<void> => {
      const snap = buildSnapshot({
        clientRev: params.nextClientRev,
        demoCounter: params.nextDemoCounter,
        pageId: DEMO_PAGE_ID,
        contentHash: DEMO_CONTENT_HASH,
        paletteIdx: params.nextPaletteIdx,
        progressB64: params.nextProgressB64,
        regionsCount: DEMO_REGIONS_COUNT,
        paletteLen: DEMO_PALETTE.length,
        undoStackB64: params.nextUndoStackB64,
        undoUsed: params.nextUndoUsed,
      })
      await savePageSnapshot(snap)
    },
    [],
  )

  // Restore local snapshot (no network) + route restore.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const lp = await loadLastPageId()
      const snap = await loadPageSnapshot(DEMO_PAGE_ID, DEMO_CONTENT_HASH)

      if (cancelled) return

      const normalizedLp = normalizePageId(lp)
      setLastPageId(normalizedLp)
      if (normalizedLp) setRoute({ name: "page", pageId: normalizedLp })

      if (snap) {
        setClientRev(clampNonNegativeInt(snap.clientRev, 0))
        setDemoCounter(clampNonNegativeInt(snap.demoCounter, 0))

        const nextPalette =
          typeof snap.paletteIdx === "number"
            ? safeColorIndex(snap.paletteIdx)
            : 0
        setPaletteIdx(nextPalette)

        const rec = asRecord(snap)

        const nextUndoStack = safeArrayOfStrings(rec?.undoStackB64, 64)
        const nextUndoUsed = clampNonNegativeInt(rec?.undoBudgetUsed, 0)
        setUndoStackB64(nextUndoStack)
        setUndoBudgetUsed(nextUndoUsed)

        const packed =
          typeof rec?.progressB64 === "string" ? rec.progressB64.trim() : ""
        const rc = clampNonNegativeInt(rec?.regionsCount, 0)
        const pl = clampNonNegativeInt(rec?.paletteLen, 0)

        if (packed && rc > 0 && pl > 0) {
          setProgressB64(packed)

          // decodeProgressB64ToFillMap expects positional args (b64, regionsCount, paletteLen, palette)
          const decodedFills = decodeProgressB64ToFillMap({
            progressB64: packed,
            regionsCount: rc,
            paletteLen: pl,
            regionOrder: DEMO_REGION_ORDER,
            palette: DEMO_PALETTE,
          })
          setFills(decodedFills)
        } else {
          // Legacy or partially migrated snapshot: fall back to fills if present.
          const legacy = sanitizeFillMap(rec?.fills)
          setFills(legacy)
          setProgressB64("")
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Server restore (me/state includes only lastPageId/clientRev)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!canCallServer) return

      try {
        const res = await getMeState()
        if (cancelled) return

        setServerState(res.state)

        const st = res.state
        if (!st) return

        const normalized = normalizePageId(st.lastPageId)

        if (!lastPageId && normalized) {
          setLastPageId(normalized)
          setRoute({ name: "page", pageId: normalized })
          await saveLastPageId(normalized)
        }

        // Keep local rev monotonic w.r.t server (idempotency)
        if (st.clientRev > clientRevRef.current) {
          const nextClientRev = st.clientRev
          setClientRev(nextClientRev)

          await persistSnapshotNow({
            nextClientRev,
            nextDemoCounter: demoCounterRef.current,
            nextPaletteIdx: paletteIdxRef.current,
            nextProgressB64: progressB64Ref.current,
            nextUndoStackB64: undoStackRef.current,
            nextUndoUsed: undoUsedRef.current,
          })
        }
      } catch (e) {
        setOut((prev) =>
          prev === "idle"
            ? `WARN: server restore failed: ${(e as Error).message}`
            : prev,
        )
      }
    })()

    return () => {
      cancelled = true
    }
    // Intentionally keep lastPageId out: server restore should not re-run on local page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCallServer, persistSnapshotNow])

  const flushOutboxOnce = useCallback(async (): Promise<void> => {
    if (!canCallServer) return
    if (flushingRef.current) return

    const pending = await loadPendingMeState()
    if (!pending) return

    flushingRef.current = true
    try {
      const res = await putMeState({
        lastPageId: pending.lastPageId,
        clientRev: pending.clientRev,
      })
      setServerState(res.state)

      if (res.state && res.state.clientRev >= pending.clientRev) {
        await clearPendingMeState()
      }
    } catch {
      // keep pending; retry later
    } finally {
      flushingRef.current = false
    }
  }, [canCallServer])

  const scheduleFlush = useCallback(
    async (delayMs: number): Promise<void> => {
      if (!canCallServer) return

      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }

      flushTimerRef.current = window.setTimeout(
        () => {
          flushTimerRef.current = null
          void flushOutboxOnce()
        },
        Math.max(0, Math.trunc(delayMs)),
      )
    },
    [canCallServer, flushOutboxOnce],
  )

  useEffect(() => {
    if (!canCallServer) return
    void flushOutboxOnce()
  }, [canCallServer, flushOutboxOnce])

  // ===== SVG mount + apply fills (only when on page route) =====
  useEffect(() => {
    if (route.name !== "page") return

    const host = svgHostRef.current
    if (!host) return

    const res: MountResult = mountSvgIntoHost(host, demoSvg, {
      requireViewBox: true,
      requireRegionIdPattern: true,
      regionIdPattern: /^R\d{3}$/,
      sanitize: true,
    })

    if (!res.ok) {
      setOut((prev) => (prev === "idle" ? `ERR: ${res.reason}` : prev))
      host.replaceChildren()
      return
    }

    applyFillsToContainer(host, fills)
  }, [route.name, fills])

  // ===== Zoom/Pan attach (only when on page route) =====
  useEffect(() => {
    if (route.name !== "page") return

    const container = zoomContainerRef.current
    const content = zoomContentRef.current
    if (!container || !content) return

    applyTransformStyle(content, transform)

    const zp = attachZoomPan(container, {
      onTransform: (t) => setTransform(t),
      onGestureState: (s) => setIsGesturing(s.isGesturing || s.isWheelZooming),
      initial: transform,
    })

    return () => {
      zp.destroy()
    }
    // transform is applied imperatively; avoid reattaching for each transform tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name])

  function activeColor(): string {
    return DEMO_PALETTE[safeColorIndex(paletteIdx, DEMO_PALETTE)]
  }

  async function commitLocalMutation(params: {
    nextFills: FillMap
    nextProgressB64: string
    nextPaletteIdx: number
    nextUndoStackB64: string[]
    nextUndoUsed: number
    tapLabel: string
  }): Promise<void> {
    const nextClientRev = clientRevRef.current + 1
    const nextDemoCounter = demoCounterRef.current + 1

    setClientRev(nextClientRev)
    setDemoCounter(nextDemoCounter)
    setFills(params.nextFills)
    setProgressB64(params.nextProgressB64)
    setPaletteIdx(params.nextPaletteIdx)
    setUndoStackB64(params.nextUndoStackB64)
    setUndoBudgetUsed(params.nextUndoUsed)
    setLastTap(params.tapLabel)

    await persistSnapshotNow({
      nextClientRev,
      nextDemoCounter,
      nextPaletteIdx: params.nextPaletteIdx,
      nextProgressB64: params.nextProgressB64,
      nextUndoStackB64: params.nextUndoStackB64,
      nextUndoUsed: params.nextUndoUsed,
    })

    setLastPageId(DEMO_PAGE_ID)
    await saveLastPageId(DEMO_PAGE_ID)

    await enqueueMeState(DEMO_PAGE_ID, nextClientRev)
    await scheduleFlush(600)
  }

  // ===== Tap-to-fill handler (blocked during gesture) =====
  async function onPointerUp(e: React.PointerEvent) {
    // Prevent iOS double-tap zoom / delayed click synthesis
    e.preventDefault()
    e.stopPropagation()

    const isTouch = e.pointerType === "touch"

    // Cleanup: ensure touch pointerId does not accumulate even on early returns.
    // Delay must be > debounce window used below.
    const touchPid = isTouch ? e.pointerId : -1
    if (isTouch) {
      window.setTimeout(() => {
        activeTouchIdsRef.current.delete(touchPid)
      }, 250)
    }

    // Never fill while zoom/pan is actively gesturing.
    if (isGesturingRef.current) return

    if (typeof e.button === "number" && e.button !== 0) return

    // For touch:
    // - ignore non-primary touches
    // - short delay: if a second finger arrives (pinch) or zoom/pan engages, abort filling
    const x = clampInt(e.clientX, 0, window.innerWidth)
    const y = clampInt(e.clientY, 0, window.innerHeight)

    if (isTouch) {
      if (!e.isPrimary) return
      const pointerId = e.pointerId

      // If multi-touch already active -> treat as pinch, do not fill.
      if (activeTouchIdsRef.current.size >= 2) return

      await new Promise<void>((resolve) => window.setTimeout(resolve, 60))

      // Pointer lifted/cancelled, multi-touch started, or gesture engaged -> do not fill.
      if (!activeTouchIdsRef.current.has(pointerId)) return
      if (activeTouchIdsRef.current.size >= 2) return
      if (isGesturingRef.current) return
    }
    if (typeof e.button === "number" && e.button !== 0) return

    const host = svgHostRef.current
    if (!host) return

    const hit = hitTestRegionAtPoint(x, y, {
      requireRegionIdPattern: true,
      regionIdPattern: /^R\d{3}$/,
    })

    if (!hit) {
      setLastTap("tap: no region")
      return
    }

    const color = activeColor()
    applyFillToRegion(host, hit.regionId, color)

    const prev = fillsRef.current
    const nextFills: FillMap =
      prev[hit.regionId] === color ? prev : { ...prev, [hit.regionId]: color }

    // Until regionIndex mapping exists, preserve packed progress as-is.
    const nextProgressB64 = progressB64Ref.current

    // Undo: push previous packed state if available.
    const prevUndo = undoStackRef.current
    const prevPacked = progressB64Ref.current
    const nextUndoStack = prevPacked
      ? [...prevUndo, prevPacked].slice(-64)
      : prevUndo

    await commitLocalMutation({
      nextFills,
      nextProgressB64,
      nextPaletteIdx: paletteIdxRef.current,
      nextUndoStackB64: nextUndoStack,
      nextUndoUsed: undoUsedRef.current, // budget is consumed by undo, not by fill
      tapLabel: `filled ${hit.regionId} -> ${color}`,
    })
  }

  function goGallery(): void {
    setRoute({ name: "gallery" })
  }

  async function openPage(pageId: string): Promise<void> {
    const id = normalizePageId(pageId)
    if (!id) return

    rewardDismissedRef.current = false
    setRewardOpen(false)

    setRoute({ name: "page", pageId: id })
    setLastPageId(id)
    await saveLastPageId(id)
  }

  async function hardResetAllLocal(): Promise<void> {
    await deletePageSnapshot(DEMO_PAGE_ID, DEMO_CONTENT_HASH)
    await saveLastPageId(null)
    await clearPendingMeState()

    rewardDismissedRef.current = false
    setRewardOpen(false)

    setClientRev(0)
    setDemoCounter(0)
    setLastPageId(null)
    setServerState(null)
    setFills({})
    setProgressB64("")
    setPaletteIdx(0)
    setUndoStackB64([])
    setUndoBudgetUsed(0)
    setLastTap("none")
    setOut("idle")

    const t: ZoomPanTransform = { scale: 1, tx: 0, ty: 0 }
    setTransform(t)
    const content = zoomContentRef.current
    if (content) applyTransformStyle(content, t)

    setRoute({ name: "gallery" })

    await persistSnapshotNow({
      nextClientRev: 0,
      nextDemoCounter: 0,
      nextPaletteIdx: 0,
      nextProgressB64: "",
      nextUndoStackB64: [],
      nextUndoUsed: 0,
    })
  }

  // ===== Page Reset (Start Over) =====
  async function startOverPageConfirmed(): Promise<void> {
    setConfirmResetOpen(false)
    setRewardOpen(false)
    rewardDismissedRef.current = false

    // Reset progress but keep session undo budget used (hard per-session policy).
    const nextUndoUsed = undoUsedRef.current

    const nextFills: FillMap = {}
    const nextProgress = ""
    const nextUndoStack: string[] = []

    const t: ZoomPanTransform = { scale: 1, tx: 0, ty: 0 }
    setTransform(t)
    const content = zoomContentRef.current
    if (content) applyTransformStyle(content, t)

    const host = svgHostRef.current
    if (host) applyFillsToContainer(host, nextFills)

    await commitLocalMutation({
      nextFills,
      nextProgressB64: nextProgress,
      nextPaletteIdx: 0,
      nextUndoStackB64: nextUndoStack,
      nextUndoUsed,
      tapLabel: "reset: start over",
    })
  }

  // ===== Undo (budgeted) =====
  const undoLeft = useMemo(
    () =>
      Math.max(
        0,
        UNDO_BUDGET_PER_SESSION - clampNonNegativeInt(undoBudgetUsed, 0),
      ),
    [undoBudgetUsed],
  )

  const canUndo = useMemo(
    () => undoLeft > 0 && undoStackB64.length > 0,
    [undoLeft, undoStackB64.length],
  )

  async function undoOneBudgeted(): Promise<void> {
    if (!canUndo) return

    const stack = undoStackRef.current
    if (stack.length <= 0) return

    const prevPacked = stack[stack.length - 1]
    const nextStack = stack.slice(0, -1)
    const nextUsed = clampNonNegativeInt(undoUsedRef.current, 0) + 1

    let nextFills: FillMap = {}
    try {
      nextFills = decodeProgressB64ToFillMap({
        progressB64: prevPacked,
        regionsCount: DEMO_REGIONS_COUNT,
        paletteLen: DEMO_PALETTE.length,
        regionOrder: DEMO_REGION_ORDER,
        palette: DEMO_PALETTE,
      })
    } catch {
      nextFills = {}
    }

    const host = svgHostRef.current
    if (host) applyFillsToContainer(host, nextFills)

    await commitLocalMutation({
      nextFills,
      nextProgressB64: prevPacked,
      nextPaletteIdx: paletteIdxRef.current,
      nextUndoStackB64: nextStack,
      nextUndoUsed: nextUsed,
      tapLabel: "undo",
    })
  }

  async function runSmokePutState() {
    setOut("calling...")
    try {
      const res = await putMeState({ lastPageId: DEMO_PAGE_ID, clientRev })
      setServerState(res.state)
      setOut(`OK: ${safeJson(res)}`)
    } catch (e) {
      setOut(`ERR: ${(e as Error).message}`)
    }
  }

  async function testIdempotencySameClientRev() {
    setOut("calling same clientRev...")
    const fixedRev = clientRev
    try {
      const a = await putMeState({ lastPageId: "page_A", clientRev: fixedRev })
      const b = await putMeState({ lastPageId: "page_B", clientRev: fixedRev })
      setServerState(b.state)

      setOut(
        `OK:\n1) ${safeJson(a)}\n2) ${safeJson(b)}\n\nEXPECTED: lastPageId remains "page_A" after second call`,
      )
    } catch (e) {
      setOut(`ERR: ${(e as Error).message}`)
    }
  }

  const canDebugServer = canCallServer

  const percent = useMemo(() => {
    return Math.min(
      100,
      Math.round(
        (Object.keys(fills).length / Math.max(1, DEMO_REGIONS_COUNT)) * 100,
      ),
    )
  }, [fills])

  const completed = useMemo(() => {
    return Object.keys(fills).length >= DEMO_REGIONS_COUNT
  }, [fills])

  // Completion detector -> reward overlay
  useEffect(() => {
    if (route.name !== "page") return
    if (!completed) return
    if (rewardDismissedRef.current) return

    setRewardOpen(true)
  }, [completed, route.name])

  function dismissReward(): void {
    rewardDismissedRef.current = true
    setRewardOpen(false)
  }

  return (
    <div
      style={{
        minHeight: "var(--tg-vh, 100dvh)",
        padding:
          "max(env(safe-area-inset-top), 12px) max(env(safe-area-inset-right), 12px) max(env(safe-area-inset-bottom), 12px) max(env(safe-area-inset-left), 12px)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        background: "var(--tg-theme-bg-color, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0 }}>Tap2Fill</h1>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {runtimeLabel} · initData {initDataLen}
        </div>
      </div>

      {route.name === "gallery" && (
        <div style={{ marginTop: 10 }}>
          <Gallery
            progressByPageId={progressByPageId}
            lastPageId={lastPageId}
            onOpenPage={(page) => {
              void openPage(page.id)
            }}
          />

          <div className="t2f-card" style={{ marginTop: 12 }}>
            <div className="t2f-panel">
              <div className="t2f-row">
                <span>Local lastPageId</span>
                <strong>{lastPageId ?? "null"}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Local clientRev</span>
                <strong>{clientRev}</strong>
              </div>
            </div>

            <button
              className="t2f-btn"
              onClick={() => void hardResetAllLocal()}
              style={{ marginTop: 12 }}
            >
              Reset Local Snapshot
            </button>
          </div>
        </div>
      )}

      {route.name === "page" && (
        <div style={{ marginTop: 12 }}>
          <div className="t2f-pageBar">
            <div className="t2f-pageBarLeft">
              <button className="t2f-actionBtn" onClick={goGallery}>
                Gallery
              </button>
            </div>

            <div className="t2f-pageBarRight">
              <span className="t2f-pageBarMeta">
                Page <strong>{route.pageId}</strong> · {percent}%{" "}
                {completed ? "· Completed" : ""} · Undo left{" "}
                <strong>{undoLeft}</strong>
              </span>

              <button
                className="t2f-actionBtn"
                disabled={!canUndo}
                onClick={() => void undoOneBudgeted()}
                aria-disabled={!canUndo}
                title={
                  !canUndo
                    ? "Undo unavailable (no history or budget exhausted)"
                    : "Undo"
                }
              >
                Undo
              </button>

              <button
                className="t2f-actionBtn t2f-actionBtnDanger"
                onClick={() => setConfirmResetOpen(true)}
              >
                Start Over
              </button>
            </div>
          </div>
          {/* Palette */}
          <div className="t2f-card" style={{ marginTop: 12 }}>
            <div className="t2f-panel">
              <div className="t2f-palette">
                {DEMO_PALETTE.map((c, idx) => {
                  const active =
                    idx === safeColorIndex(paletteIdx, DEMO_PALETTE)
                  return (
                    <button
                      key={c}
                      onClick={() => void setPaletteIdx(idx)}
                      className={
                        active ? "t2f-swatch t2f-swatchActive" : "t2f-swatch"
                      }
                      style={{ background: c }}
                      aria-label={`color ${c}`}
                    />
                  )
                })}
                <span className="t2f-activeColor">
                  Active: <strong>{activeColor()}</strong>
                </span>
              </div>
            </div>
          </div>
          {/* Zoom/Pan + Canvas */}
          <div
            ref={zoomContainerRef}
            className="t2f-canvas zp-container t2f-overlayHost"
            onPointerDownCapture={onCanvasPointerDownCapture}
            onPointerUpCapture={onCanvasPointerUpCapture}
            onPointerCancelCapture={onCanvasPointerCancelCapture}
            onPointerUp={onPointerUp}
            style={{ marginTop: 12, height: 520 }}
            aria-label="Coloring canvas"
          >
            <div ref={zoomContentRef} className="zp-content">
              <div ref={svgHostRef} className="t2f-svgHost" />
            </div>
          </div>
          <div className="t2f-meta" style={{ marginTop: 10 }}>
            Last action: <strong>{lastTap}</strong> · Filled:{" "}
            <strong>{Object.keys(fills).length}</strong>
            <span style={{ marginLeft: 10, opacity: 0.75 }}>
              · Gesture: <strong>{isGesturing ? "active" : "idle"}</strong> ·
              Transform:{" "}
              <strong>{`s=${transform.scale.toFixed(2)} tx=${Math.round(transform.tx)} ty=${Math.round(
                transform.ty,
              )}`}</strong>
            </span>
          </div>
          <ConfirmModal
            open={confirmResetOpen}
            title="Reset page?"
            description="This will clear all fills on this page. This cannot be undone once confirmed."
            confirmText="Reset"
            cancelText="Cancel"
            variant="danger"
            closeOnBackdrop={false}
            onConfirm={startOverPageConfirmed}
            onClose={() => setConfirmResetOpen(false)}
          />
          <CompletionReward
            open={rewardOpen}
            percent={percent}
            onClose={dismissReward}
            onBack={() => {
              dismissReward()
              goGallery()
            }}
            onNext={() => {
              dismissReward()
              goGallery()
            }}
          />
          {/* Debug panel (kept) */}
          <div className="t2f-card" style={{ marginTop: 12 }}>
            <div className="t2f-panel">
              <div className="t2f-row">
                <span>Local lastPageId</span>
                <strong>{lastPageId ?? "null"}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Local clientRev</span>
                <strong>{clientRev}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Local demoCounter</span>
                <strong>{demoCounter}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Local progressB64</span>
                <strong>
                  {progressB64 ? `${progressB64.length} chars` : "empty"}
                </strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Undo stack</span>
                <strong>{undoStackB64.length}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Undo used</span>
                <strong>{undoBudgetUsed}</strong>
              </div>
            </div>

            <div className="t2f-panel t2f-panelAlt" style={{ marginTop: 12 }}>
              <div className="t2f-row">
                <span>Server lastPageId</span>
                <strong>{serverState?.lastPageId ?? "null"}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Server clientRev</span>
                <strong>{serverState?.clientRev ?? 0}</strong>
              </div>
            </div>

            <button
              className="t2f-btn"
              onClick={() => void scheduleFlush(0)}
              style={{ marginTop: 12 }}
            >
              Flush Outbox Now
            </button>

            <button
              className="t2f-btn"
              onClick={testIdempotencySameClientRev}
              disabled={!canDebugServer}
              style={{ marginTop: 10, opacity: !canDebugServer ? 0.5 : 0.9 }}
            >
              Test Idempotency (same clientRev)
            </button>

            <button
              className="t2f-btn"
              onClick={runSmokePutState}
              disabled={!canDebugServer}
              style={{ marginTop: 10, opacity: !canDebugServer ? 0.5 : 1 }}
            >
              Run Smoke Test (PUT /v1/me/state)
            </button>

            <button
              className="t2f-btn"
              onClick={() => void hardResetAllLocal()}
              style={{ marginTop: 10, opacity: 0.9 }}
            >
              Reset Local Snapshot
            </button>

            <pre className="t2f-pre" style={{ marginTop: 12 }}>
              {out}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
