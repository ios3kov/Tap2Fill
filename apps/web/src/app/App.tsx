// apps/web/src/app/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { getInitData, isTma, tmaBootstrap } from "../lib/tma";
import { getMeState, putMeState, type MeState, hasTelegramInitData } from "../lib/api";
import {
  deletePageSnapshot,
  loadLastPageId,
  loadPageSnapshot,
  saveLastPageId,
  savePageSnapshot,
  type PageSnapshotV1,
} from "../local/snapshot";
import { clearPendingMeState, enqueueMeState, loadPendingMeState } from "../local/outbox";

import demoSvg from "./demoPage.svg?raw";
import { DEFAULT_PALETTE, applyFillsToContainer, safeColorIndex, type FillMap } from "./coloring";
import {
  applyFillToRegion,
  hitTestRegionAtPoint,
  mountSvgIntoHost,
  type MountResult,
} from "./svgTapToFill";

import "./svgTapToFill.css";

const DEMO_PAGE_ID = "page_demo_1";
const DEMO_CONTENT_HASH = "demo_hash_v1";

/**
 * Stage 2 (Happy Path) – One page tap-to-fill
 * Goals:
 *  - TMA bootstrap + safe-area sizing
 *  - SVG contract: viewBox + data-region + outline pointer-events off (via css + mount)
 *  - Hardened hit test: elementFromPoint -> climb to [data-region]
 *  - Local-first: apply fill instantly; advance clientRev; snapshot; enqueue me/state; batched sync
 */

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default function App() {
  const [out, setOut] = useState("idle");
  const [tick, setTick] = useState(0);

  // Local-first state
  const [clientRev, setClientRev] = useState(0);
  const [demoCounter, setDemoCounter] = useState(0);
  const [lastPageId, setLastPageId] = useState<string | null>(null);

  // Visibility: server
  const [serverState, setServerState] = useState<MeState | null>(null);

  // Stage 2: coloring UI state (local-only)
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [fills, setFills] = useState<FillMap>({});
  const [lastTap, setLastTap] = useState<string>("none");

  const svgHostRef = useRef<HTMLDivElement | null>(null);

  // Batched sync refs
  const flushTimerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);

  // Stable refs for async flows
  const clientRevRef = useRef(0);
  const demoCounterRef = useRef(0);

  useEffect(() => {
    clientRevRef.current = clientRev;
  }, [clientRev]);

  useEffect(() => {
    demoCounterRef.current = demoCounter;
  }, [demoCounter]);

  useEffect(() => {
    const cleanup = tmaBootstrap();

    // Small tick window: for initData length label without re-rendering forever
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    window.setTimeout(() => window.clearInterval(id), 3000);

    return () => {
      window.clearInterval(id);
      cleanup?.();
    };
  }, []);

  const initDataLen = useMemo(() => getInitData().length, [tick]);
  const runtimeLabel = isTma() ? "Telegram Mini App" : "Web (standalone)";
  const canCallServer = hasTelegramInitData();

  // Restore local snapshots (no network)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lp = await loadLastPageId();
      const snap = await loadPageSnapshot(DEMO_PAGE_ID, DEMO_CONTENT_HASH);

      if (cancelled) return;
      setLastPageId(lp);

      if (snap) {
        setClientRev(snap.clientRev);
        setDemoCounter(snap.demoCounter);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Server restore (pull on start):
   * If server.clientRev > local.clientRev -> apply locally.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!canCallServer) return;

      try {
        const res = await getMeState();
        if (cancelled) return;

        setServerState(res.state);

        const st = res.state;
        if (!st) return;

        if (st.clientRev > clientRevRef.current) {
          setClientRev(st.clientRev);
          setLastPageId(st.lastPageId);

          // Stage 2 keeps fills local-only; we persist rev for deterministic restore.
          const snap: PageSnapshotV1 = {
            schemaVersion: 1,
            pageId: DEMO_PAGE_ID,
            contentHash: DEMO_CONTENT_HASH,
            clientRev: st.clientRev,
            demoCounter: demoCounterRef.current,
            updatedAtMs: Date.now(),
          };

          await savePageSnapshot(snap);
          await saveLastPageId(st.lastPageId);
        }
      } catch (e) {
        setOut((prev) => (prev === "idle" ? `WARN: server restore failed: ${(e as Error).message}` : prev));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canCallServer]);

  async function flushOutboxOnce(): Promise<void> {
    if (!canCallServer) return;
    if (flushingRef.current) return;

    const pending = await loadPendingMeState();
    if (!pending) return;

    flushingRef.current = true;
    try {
      const res = await putMeState({ lastPageId: pending.lastPageId, clientRev: pending.clientRev });
      setServerState(res.state);

      // Clear if server acknowledged >= our rev
      if (res.state && res.state.clientRev >= pending.clientRev) {
        await clearPendingMeState();
      }
    } catch {
      // keep pending; retry later
    } finally {
      flushingRef.current = false;
    }
  }

  async function scheduleFlush(delayMs: number): Promise<void> {
    if (!canCallServer) return;

    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flushOutboxOnce();
    }, Math.max(0, Math.trunc(delayMs)));
  }

  // On boot: attempt to flush pending outbox (best-effort).
  useEffect(() => {
    if (!canCallServer) return;
    void flushOutboxOnce();
  }, [canCallServer]);

  // ===== Stage 2: SVG mount (contract + sanitize + root attrs) + apply fills =====
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    const res: MountResult = mountSvgIntoHost(host, demoSvg, {
      requireViewBox: true,
      requireRegionIdPattern: true,
      regionIdPattern: /^R\d{3}$/,
      sanitize: true,
    });

    if (!res.ok) {
      setOut((prev) => (prev === "idle" ? `ERR: ${res.reason}` : prev));
      host.replaceChildren();
      return;
    }

    // Apply current fills (Stage 2: local-only)
    applyFillsToContainer(host, fills);
  }, [fills]);

  function activeColor(): string {
    return DEFAULT_PALETTE[safeColorIndex(paletteIdx)];
  }

  /**
   * Local-first action: advance rev + persist snapshot + enqueue server me/state + schedule batched push.
   * Stage 2: snapshot does not yet contain fills (progress comes next), but rev stays monotonic.
   */
  async function advanceLocalRevAndEnqueue(): Promise<void> {
    const nextRev = clientRevRef.current + 1;
    const nextCounter = demoCounterRef.current + 1;

    setClientRev(nextRev);
    setDemoCounter(nextCounter);

    const snap: PageSnapshotV1 = {
      schemaVersion: 1,
      pageId: DEMO_PAGE_ID,
      contentHash: DEMO_CONTENT_HASH,
      clientRev: nextRev,
      demoCounter: nextCounter,
      updatedAtMs: Date.now(),
    };
    await savePageSnapshot(snap);

    const newLast = DEMO_PAGE_ID;
    setLastPageId(newLast);
    await saveLastPageId(newLast);

    await enqueueMeState(newLast, nextRev);
    await scheduleFlush(600);
  }

  async function runSmokePutState() {
    setOut("calling...");
    try {
      const res = await putMeState({ lastPageId: DEMO_PAGE_ID, clientRev });
      setServerState(res.state);
      setOut(`OK: ${safeJson(res)}`);
    } catch (e) {
      setOut(`ERR: ${(e as Error).message}`);
    }
  }

  async function testIdempotencySameClientRev() {
    setOut("calling same clientRev...");
    const fixedRev = clientRev; // DO NOT increase
    try {
      const a = await putMeState({ lastPageId: "page_A", clientRev: fixedRev });
      const b = await putMeState({ lastPageId: "page_B", clientRev: fixedRev });
      setServerState(b.state);

      setOut(
        `OK:\n1) ${safeJson(a)}\n2) ${safeJson(b)}\n\nEXPECTED: lastPageId remains "page_A" after second call`,
      );
    } catch (e) {
      setOut(`ERR: ${(e as Error).message}`);
    }
  }

  // ===== Stage 2: tap-to-fill handler =====
  async function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;

    const host = svgHostRef.current;
    if (!host) return;

    // Clamp coords defensively (viewport coords)
    const x = clampInt(e.clientX, 0, window.innerWidth);
    const y = clampInt(e.clientY, 0, window.innerHeight);

    const hit = hitTestRegionAtPoint(x, y, {
      requireRegionIdPattern: true,
      regionIdPattern: /^R\d{3}$/,
    });

    if (!hit) {
      setLastTap("tap: no region");
      return;
    }

    const color = activeColor();

    // Apply to DOM immediately (responsiveness)
    applyFillToRegion(host, hit.regionId, color);

    // Commit local fill state
    setFills((prev) => {
      if (prev[hit.regionId] === color) return prev;
      return { ...prev, [hit.regionId]: color };
    });

    setLastTap(`filled ${hit.regionId} -> ${color}`);

    // Advance revision + enqueue cross-device restore sync
    await advanceLocalRevAndEnqueue();
  }

  async function resetLocal() {
    await deletePageSnapshot(DEMO_PAGE_ID, DEMO_CONTENT_HASH);
    await saveLastPageId(null);
    await clearPendingMeState();

    setClientRev(0);
    setDemoCounter(0);
    setLastPageId(null);
    setServerState(null);
    setFills({});
    setLastTap("none");
    setOut("idle");
  }

  const canDebugServer = canCallServer;

  return (
    <div
      style={{
        minHeight: "var(--tg-vh, 100dvh)",
        padding:
          "max(env(safe-area-inset-top), 12px) max(env(safe-area-inset-right), 12px) max(env(safe-area-inset-bottom), 12px) max(env(safe-area-inset-left), 12px)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <h1 style={{ margin: 0 }}>Tap2Fill</h1>
      <p style={{ opacity: 0.7, marginTop: 6 }}>Local-first + server restore + batched sync + tap-to-fill</p>

      {/* Stage 2: Coloring surface */}
      <div className="t2f-card" style={{ marginTop: 12 }}>
        <div className="t2f-row">
          <span>Runtime</span>
          <strong>{runtimeLabel}</strong>
        </div>

        <div className="t2f-row t2f-rowMuted" style={{ marginTop: 8 }}>
          <span>initData length</span>
          <strong>{initDataLen}</strong>
        </div>

        <div className="t2f-palette" style={{ marginTop: 12 }}>
          {DEFAULT_PALETTE.map((c, idx) => {
            const active = idx === safeColorIndex(paletteIdx);
            return (
              <button
                key={c}
                onClick={() => setPaletteIdx(idx)}
                className={active ? "t2f-swatch t2f-swatchActive" : "t2f-swatch"}
                style={{ background: c }}
                aria-label={`color ${c}`}
              />
            );
          })}
          <span className="t2f-activeColor">
            Active: <strong>{activeColor()}</strong>
          </span>
        </div>

        <div className="t2f-canvas" onPointerDown={onPointerDown} style={{ marginTop: 12 }}>
          <div ref={svgHostRef} className="t2f-svgHost" />
        </div>

        <div className="t2f-meta" style={{ marginTop: 10 }}>
          Last tap: <strong>{lastTap}</strong> · Filled: <strong>{Object.keys(fills).length}</strong>
        </div>
      </div>

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

        <button className="t2f-btn" onClick={advanceLocalRevAndEnqueue} style={{ marginTop: 12 }}>
          Simulate Local Action (snapshot + enqueue sync)
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

        <button className="t2f-btn" onClick={resetLocal} style={{ marginTop: 10, opacity: 0.9 }}>
          Reset Local Snapshot
        </button>

        <pre className="t2f-pre" style={{ marginTop: 12 }}>
          {out}
        </pre>
      </div>

      <div className="t2f-footnote" style={{ marginTop: 10 }}>
        Stage 2: fills are local-only; we sync only (lastPageId, clientRev) for cross-device restore of the user’s last
        page. Next step: persist fills via page snapshot payload and/or /v1/progress.
      </div>
    </div>
  );
}