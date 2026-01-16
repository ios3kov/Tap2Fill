// apps/web/src/app/App.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getInitData, isTma } from "../lib/tma"
import { hasTelegramInitData, type MeState } from "../lib/api"
import {
  deletePageSnapshot,
  saveLastPageId,
  savePageSnapshot,
} from "../local/snapshot"

import demoSvg from "./demoPage.svg?raw"
import {
  DEFAULT_PALETTE,
  applyFillsToContainer,
  safeColorIndex,
  type FillMap,
} from "./coloring"

import Gallery from "./ui/Gallery"
import "./ui/gallery.css"
import { ConfirmModal } from "./ui/ConfirmModal"
import { CompletionReward } from "./ui/CompletionReward"
import "./ui/page.css"
import "./svgTapToFill.css"
import "./viewport/zoomPan.css"

import { APP_CONFIG } from "./config/appConfig"
import { normalizePageId } from "./domain/guards"
import { buildSnapshot } from "./domain/snapshotBuilder"
import { decodeProgressB64ToFillMap } from "./progress/pack"

import { useBootstrap } from "./hooks/useBootstrap"
import { useOutboxSync } from "./hooks/useOutboxSync"
import { useUndoHistory } from "./hooks/useUndoHistory"
import { useLocalRestore } from "./hooks/useLocalRestore"
import { useServerRestore } from "./hooks/useServerRestore"
import { useSvgPage } from "./hooks/useSvgPage"
import { useZoomPan, applyTransformStyle } from "./hooks/useZoomPan"
import { useTapToFillHandlers } from "./hooks/useTapToFillHandlers"

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

export default function App() {
  const [out, setOut] = useState("idle")
  const { tick } = useBootstrap()

  // Routing
  const [route, setRoute] = useState<Route>({ name: "gallery" })

  // Local-first state
  const [clientRev, setClientRev] = useState(0)
  const [demoCounter, setDemoCounter] = useState(0)
  const [lastPageId, setLastPageId] = useState<string | null>(null)

  // Visibility: server
  const [serverState, setServerState] = useState<MeState | null>(null)

  // Coloring UI state
  const [paletteIdx, setPaletteIdx] = useState(0)
  const [fills, setFills] = useState<FillMap>({})
  const [lastTap, setLastTap] = useState<string>("none")

  // Packed progress (forward compatible storage)
  const [progressB64, setProgressB64] = useState<string>("")

  // Zoom/Pan state
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 })
  const [isGesturing, setIsGesturing] = useState(false)

  // Page UX: confirm + reward overlay
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [rewardDismissed, setRewardDismissed] = useState(false)

  // Derived state: no setState-in-effect
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

  const rewardOpen = route.name === "page" && completed && !rewardDismissed

  function dismissReward(): void {
    setRewardDismissed(true)
  }

  // Refs for DOM
  const svgHostRef = useRef<HTMLDivElement | null>(null)
  const zoomContainerRef = useRef<HTMLDivElement | null>(null)
  const zoomContentRef = useRef<HTMLDivElement | null>(null)

  // Stable refs for async flows
  const clientRevRef = useRef(0)
  const demoCounterRef = useRef(0)
  const paletteIdxRef = useRef(0)
  const fillsRef = useRef<FillMap>({})
  const progressB64Ref = useRef<string>("")
  const isGesturingRef = useRef(false)

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
    isGesturingRef.current = isGesturing
  }, [isGesturing])

  void tick

  const initDataLen = getInitData().length
  const runtimeLabel = isTma() ? "Telegram Mini App" : "Web (standalone)"
  const canCallServer = hasTelegramInitData()

  // Undo history isolated
  const history = useUndoHistory({ budgetPerSession: UNDO_BUDGET_PER_SESSION })

  // Network outbox isolated
  const outbox = useOutboxSync({ enabled: canCallServer, setServerState })

  // Persist snapshot (domain function + storage)
  const persistSnapshotNow = useCallback(
    async (p: {
      nextClientRev: number
      nextDemoCounter: number
      nextPaletteIdx: number
      nextProgressB64: string
      nextUndoStackB64: string[]
      nextUndoUsed: number
    }) => {
      const snap = buildSnapshot({
        clientRev: p.nextClientRev,
        demoCounter: p.nextDemoCounter,
        pageId: DEMO_PAGE_ID,
        contentHash: DEMO_CONTENT_HASH,
        paletteIdx: p.nextPaletteIdx,
        progressB64: p.nextProgressB64,
        regionsCount: DEMO_REGIONS_COUNT,
        paletteLen: DEMO_PALETTE.length,
        undoStackB64: p.nextUndoStackB64,
        undoUsed: p.nextUndoUsed,
      })
      await savePageSnapshot(snap)
    },
    [],
  )

  // Local restore (atomic hook)
  useLocalRestore({
    demo: {
      pageId: DEMO_PAGE_ID,
      contentHash: DEMO_CONTENT_HASH,
      regionsCount: DEMO_REGIONS_COUNT,
      palette: DEMO_PALETTE,
      regionOrder: DEMO_REGION_ORDER,
    },
    setRoute,
    setLastPageId,
    setClientRev,
    setDemoCounter,
    setPaletteIdx,
    setProgressB64,
    setFills,
    onRestoreUndo: history.setFromRestore,
  })

  // Server restore (atomic hook)
  useServerRestore({
    enabled: canCallServer,
    lastPageId,
    setLastPageId,
    setRoute,
    setServerState: (s) => setServerState(s as unknown as MeState | null),
    clientRevRef,
    setClientRev,
    persistWhenServerAhead: async (nextClientRev) => {
      await persistSnapshotNow({
        nextClientRev,
        nextDemoCounter: demoCounterRef.current,
        nextPaletteIdx: paletteIdxRef.current,
        nextProgressB64: progressB64Ref.current,
        nextUndoStackB64: history.refs.undoStackRef.current,
        nextUndoUsed: history.refs.undoUsedRef.current,
      })
    },
  })

  // SVG mount/apply fills isolated
  useSvgPage({
    enabled: route.name === "page",
    hostRef: svgHostRef,
    svgRaw: demoSvg,
    fills,
    onMountError: (reason) =>
      setOut((prev) => (prev === "idle" ? `ERR: ${reason}` : prev)),
  })

  // Zoom/pan isolated
  useZoomPan({
    enabled: route.name === "page",
    containerRef: zoomContainerRef,
    contentRef: zoomContentRef,
    transform,
    setTransform,
    setIsGesturing,
  })

  function activeColor(): string {
    return DEMO_PALETTE[safeColorIndex(paletteIdx, DEMO_PALETTE)]
  }

  /**
   * Commit local mutation = бизнес-операция:
   * - обновляет локальный UI-state
   * - сохраняет snapshot
   * - ставит в outbox и планирует flush
   *
   * Не useCallback: избегаем react-hooks/preserve-manual-memoization,
   * т.к. внутри используются ref.current зависимости.
   */
  async function commit(m: {
    nextFills: FillMap
    nextProgressB64: string
    nextPaletteIdx: number
    tapLabel: string
    // Optional override for history snapshot persistence (used by undo).
    nextUndoStackB64?: string[]
    nextUndoUsed?: number
  }): Promise<void> {
    const nextClientRev = clientRevRef.current + 1
    const nextDemoCounter = demoCounterRef.current + 1

    setClientRev(nextClientRev)
    setDemoCounter(nextDemoCounter)
    setFills(m.nextFills)
    setProgressB64(m.nextProgressB64)
    setPaletteIdx(m.nextPaletteIdx)
    setLastTap(m.tapLabel)

    const undoStackB64 = m.nextUndoStackB64 ?? history.refs.undoStackRef.current
    const undoUsed = m.nextUndoUsed ?? history.refs.undoUsedRef.current

    await persistSnapshotNow({
      nextClientRev,
      nextDemoCounter,
      nextPaletteIdx: m.nextPaletteIdx,
      nextProgressB64: m.nextProgressB64,
      nextUndoStackB64: undoStackB64,
      nextUndoUsed: undoUsed,
    })

    setLastPageId(DEMO_PAGE_ID)
    await saveLastPageId(DEMO_PAGE_ID)

    await outbox.enqueueAndSchedule(
      DEMO_PAGE_ID,
      nextClientRev,
      APP_CONFIG.network.flushDelayMs,
    )
  }

  // Tap-to-fill UI handlers isolated (UI → domain → commit)
  const tapHandlers = useTapToFillHandlers({
    enabled: route.name === "page",
    isGesturingRef,
    svgHostRef,
    fillsRef,
    progressB64Ref,
    paletteIdxRef,
    regionOrder: DEMO_REGION_ORDER,
    palette: DEMO_PALETTE,
    activeColor,
    pushUndoSnapshot: history.pushSnapshot,
    commit,
  })

  // Gallery progress placeholder
  const progressByPageId = useMemo<
    Record<string, { pageId: string; ratio: number; completed: boolean }>
  >(() => ({}), [])

  function goGallery(): void {
    setRoute({ name: "gallery" })
  }

  async function openPage(pageId: string): Promise<void> {
    const id = normalizePageId(pageId, APP_CONFIG.limits.pageIdMaxLen)
    if (!id) return

    setRewardDismissed(false)

    setRoute({ name: "page", pageId: id })
    setLastPageId(id)
    await saveLastPageId(id)
  }

  async function hardResetAllLocal(): Promise<void> {
    await deletePageSnapshot(DEMO_PAGE_ID, DEMO_CONTENT_HASH)

    setRewardDismissed(false)

    setClientRev(0)
    setDemoCounter(0)
    setLastPageId(null)
    setServerState(null)
    setFills({})
    setProgressB64("")
    setPaletteIdx(0)
    history.resetAll()
    setLastTap("none")
    setOut("idle")

    const t = { scale: 1, tx: 0, ty: 0 }
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

  async function startOverPageConfirmed(): Promise<void> {
    setConfirmResetOpen(false)
    setRewardDismissed(false)

    // Keep budget, clear history
    history.resetKeepBudget()

    const nextFills: FillMap = {}
    const nextProgress = ""

    const t = { scale: 1, tx: 0, ty: 0 }
    setTransform(t)
    const content = zoomContentRef.current
    if (content) applyTransformStyle(content, t)

    const host = svgHostRef.current
    if (host) applyFillsToContainer(host, nextFills)

    await commit({
      nextFills,
      nextProgressB64: nextProgress,
      nextPaletteIdx: 0,
      tapLabel: "reset: start over",
    })
  }

  async function undoOneBudgeted(): Promise<void> {
    const pop = history.popSnapshotBudgeted()
    if (!pop) return

    const { packedB64, nextStack, nextUsed } = pop

    // Compute next fills from the popped snapshot.
    // (We apply to DOM immediately for responsiveness; React state will follow via commit.)
    let nextFills: FillMap = {}
    if (packedB64) {
      nextFills = decodeProgressB64ToFillMap({
        progressB64: packedB64,
        regionsCount: DEMO_REGIONS_COUNT,
        paletteLen: DEMO_PALETTE.length,
        regionOrder: DEMO_REGION_ORDER,
        palette: DEMO_PALETTE,
      })
    }

    const host = svgHostRef.current
    if (host) applyFillsToContainer(host, nextFills)

    /**
     * Atomicity note (valid comment):
     * Previously we did:
     *   history.setFromRestore(...)  + commit(...)
     * which creates two separate state updates. Instead, we persist the history
     * state into the snapshot inside commit (via overrides), and then update
     * the in-memory history once after commit completes.
     *
     * True "single transaction" would require pushing commit into the history hook.
     * This implementation is the best compromise without changing hook APIs:
     * - persisted snapshot is consistent (fills/progress + undo stack/used)
     * - UI becomes consistent as soon as commit resolves
     */
    await commit({
      nextFills,
      nextProgressB64: packedB64,
      nextPaletteIdx: paletteIdxRef.current,
      tapLabel: "undo",
      nextUndoStackB64: nextStack,
      nextUndoUsed: nextUsed,
    })

    // Now align in-memory history state with what we just persisted.
    // history.setFromRestore(nextStack, nextUsed)
  }

  const canUndo = history.canUndo
  const undoLeft = history.undoLeft

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
            onPointerDownCapture={tapHandlers.onPointerDownCapture}
            onPointerUpCapture={tapHandlers.onPointerUpCapture}
            onPointerCancelCapture={tapHandlers.onPointerCancelCapture}
            onPointerUp={tapHandlers.onPointerUp}
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

          {/* Debug panel */}
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
                <strong>{history.undoStackB64.length}</strong>
              </div>
              <div className="t2f-row" style={{ marginTop: 6 }}>
                <span>Undo used</span>
                <strong>{history.undoBudgetUsed}</strong>
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
              onClick={() => void outbox.scheduleFlush(0)}
              style={{ marginTop: 12 }}
            >
              Flush Outbox Now
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
