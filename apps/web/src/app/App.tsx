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
import { hitTestRegion } from "./hitTest";
import { DEFAULT_PALETTE, applyFillsToContainer, safeColorIndex, type FillMap } from "./coloring";

const DEMO_PAGE_ID = "page_demo_1";
const DEMO_CONTENT_HASH = "demo_hash_v1";

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}


export default function App() {
  const [out, setOut] = useState("idle");
  const [tick, setTick] = useState(0);

  // Local-first state (existing)
  const [clientRev, setClientRev] = useState(0);
  const [demoCounter, setDemoCounter] = useState(0);
  const [lastPageId, setLastPageId] = useState<string | null>(null);

  // Visibility: server
  const [serverState, setServerState] = useState<MeState | null>(null);

  // Stage 2: coloring UI state (kept local for now)
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [fills, setFills] = useState<FillMap>({});
  const [lastTap, setLastTap] = useState<string>("none");

  const svgHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const cleanup = tmaBootstrap();
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

        // Only if server is strictly ahead
        if (st.clientRev > clientRev) {
          setClientRev(st.clientRev);
          setLastPageId(st.lastPageId);

          const snap: PageSnapshotV1 = {
            schemaVersion: 1,
            pageId: DEMO_PAGE_ID,
            contentHash: DEMO_CONTENT_HASH,
            clientRev: st.clientRev,
            demoCounter, // kept local in this stage
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCallServer, clientRev, demoCounter]);

  /**
   * Batched sync (debounced push).
   */
  const flushTimerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);

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
    }, delayMs);
  }

  // On boot: attempt to flush pending outbox (best-effort).
  useEffect(() => {
    if (!canCallServer) return;
    void flushOutboxOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCallServer]);

  // ===== Stage 2: SVG mount + apply fills =====
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    host.innerHTML = demoSvg;

    const svg = host.querySelector("svg");
    if (!svg) {
      setOut((prev) => (prev === "idle" ? "WARN: SVG not mounted" : prev));
      return;
    }

    // Mark root for CSS policies
    svg.setAttribute("data-page-root", "1");

    // Apply current fills
    applyFillsToContainer(host, fills);
  }, [fills]);

  function activeColor(): string {
    return DEFAULT_PALETTE[safeColorIndex(paletteIdx)];
  }

  // Local-first action (existing): snapshot immediately + enqueue server write + schedule batched push
  async function simulateLocalAction() {
    const nextRev = clientRev + 1;
    const nextCounter = demoCounter + 1;

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

    const hit = hitTestRegion(e.clientX, e.clientY);
    if (!hit) {
      setLastTap("tap: no region");
      return;
    }

    const color = activeColor();

    // Apply to DOM immediately (responsiveness)
    const el = host.querySelector(`[data-region="${CSS.escape(hit.regionId)}"]`);
    if (el) el.setAttribute("fill", color);

    // Commit local fill state
    setFills((prev) => {
      if (prev[hit.regionId] === color) return prev;
      return { ...prev, [hit.regionId]: color };
    });

    setLastTap(`filled ${hit.regionId} -> ${color}`);

    // Treat a fill as a local-first action that advances rev.
    // For Stage 2 we link coloring interaction to the same local-first pipeline:
    // snapshot + enqueue server me/state (cross-device restore).
    await simulateLocalAction();
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
      <div
        style={{
          marginTop: 12,
          border: "1px solid rgba(127,127,127,0.25)",
          borderRadius: 14,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Runtime</span>
          <strong>{runtimeLabel}</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, opacity: 0.8 }}>
          <span>initData length</span>
          <strong>{initDataLen}</strong>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {DEFAULT_PALETTE.map((c, idx) => {
            const active = idx === safeColorIndex(paletteIdx);
            return (
              <button
                key={c}
                onClick={() => setPaletteIdx(idx)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  border: active ? "2px solid rgba(127,127,127,0.85)" : "1px solid rgba(127,127,127,0.25)",
                  background: c,
                }}
                aria-label={`color ${c}`}
              />
            );
          })}
          <span style={{ marginLeft: "auto", opacity: 0.75, fontSize: 13 }}>
            Active: <strong>{activeColor()}</strong>
          </span>
        </div>

        <div
          onPointerDown={onPointerDown}
          style={{
            marginTop: 12,
            borderRadius: 14,
            border: "1px solid rgba(127,127,127,0.25)",
            background: "rgba(127,127,127,0.06)",
            padding: 10,
            touchAction: "manipulation",
          }}
        >
          <div
            ref={svgHostRef}
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 auto",
              aspectRatio: "1 / 1",
              display: "grid",
              placeItems: "center",
            }}
          />

          {/* Hit-test hardening policy */}
          <style>{`
            [data-page-root] { width: 100%; height: auto; display: block; }
            [data-page-root] { pointer-events: none; }
            [data-page-root] [data-region] { pointer-events: all; }
            [data-page-root] [data-role="outline"] { pointer-events: none; }
          `}</style>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
          Last tap: <strong>{lastTap}</strong> · Filled: <strong>{Object.keys(fills).length}</strong>
        </div>
      </div>

      {/* Existing debug panel (kept) */}
      <div style={{ marginTop: 12, border: "1px solid rgba(127,127,127,0.25)", borderRadius: 14, padding: 14 }}>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(127,127,127,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>Local lastPageId</span>
            <strong>{lastPageId ?? "null"}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
            <span>Local clientRev</span>
            <strong>{clientRev}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
            <span>Local demoCounter</span>
            <strong>{demoCounter}</strong>
          </div>
        </div>

        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(127,127,127,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>Server lastPageId</span>
            <strong>{serverState?.lastPageId ?? "null"}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
            <span>Server clientRev</span>
            <strong>{serverState?.clientRev ?? 0}</strong>
          </div>
        </div>

        <button
          onClick={simulateLocalAction}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(127,127,127,0.35)",
            background: "transparent",
            fontWeight: 650,
          }}
        >
          Simulate Local Action (snapshot + enqueue sync)
        </button>

        <button
          onClick={testIdempotencySameClientRev}
          disabled={!canDebugServer}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(127,127,127,0.35)",
            background: "transparent",
            fontWeight: 650,
            opacity: !canDebugServer ? 0.5 : 0.9,
          }}
        >
          Test Idempotency (same clientRev)
        </button>

        <button
          onClick={runSmokePutState}
          disabled={!canDebugServer}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(127,127,127,0.35)",
            background: "transparent",
            fontWeight: 650,
            opacity: !canDebugServer ? 0.5 : 1,
          }}
        >
          Run Smoke Test (PUT /v1/me/state)
        </button>

        <button
          onClick={resetLocal}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(127,127,127,0.35)",
            background: "transparent",
            fontWeight: 650,
            opacity: 0.9,
          }}
        >
          Reset Local Snapshot
        </button>

        <pre style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(127,127,127,0.10)" }}>
          {out}
        </pre>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
        Note: Stage 2 links each fill to the existing local-first pipeline by advancing clientRev and syncing /v1/me/state.
        Region-level progress persistence will be introduced in the next step (progress API + page snapshot payload).
      </div>
    </div>
  );
}