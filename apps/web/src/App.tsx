import { useEffect, useMemo, useState } from "react";
import { getInitData, isTma, tmaBootstrap } from "./lib/tma";
import { putMeState } from "./lib/api";
import {
  deletePageSnapshot,
  loadLastPageId,
  loadPageSnapshot,
  saveLastPageId,
  savePageSnapshot,
  type PageSnapshotV1,
} from "./local/snapshot";

const DEMO_PAGE_ID = "page_demo_1";
const DEMO_CONTENT_HASH = "demo_hash_v1"; // later will be real content_hash from pages catalog

export default function App() {
  const [out, setOut] = useState("idle");
  const [tick, setTick] = useState(0);

  // Local-first state (restored from IndexedDB on boot)
  const [clientRev, setClientRev] = useState(0);
  const [demoCounter, setDemoCounter] = useState(0);
  const [lastPageId, setLastPageId] = useState<string | null>(null);

  useEffect(() => {
    tmaBootstrap();
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    window.setTimeout(() => window.clearInterval(id), 3000);
    return () => window.clearInterval(id);
  }, []);

  // Restore local snapshots on open (no network required).
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

  const initDataLen = useMemo(() => getInitData().length, [tick]);
  const runtimeLabel = isTma() ? "Telegram Mini App" : "Web (standalone)";

  async function runSmokePutState() {
    setOut("calling...");
    try {
      const res = await putMeState(DEMO_PAGE_ID);
      setOut(`OK: ${JSON.stringify(res)}`);
    } catch (e) {
      setOut(`ERR: ${(e as Error).message}`);
    }
  }

  // Local-first "action": increments local state and immediately snapshots to IndexedDB.
  async function simulateLocalAction() {
    const nextRev = clientRev + 1;
    const nextCounter = demoCounter + 1;

    setClientRev(nextRev);
    setDemoCounter(nextCounter);

    // local snapshot must be immediate and independent of network
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
  }

  async function resetLocal() {
    await deletePageSnapshot(DEMO_PAGE_ID, DEMO_CONTENT_HASH);
    await saveLastPageId(null);
    setClientRev(0);
    setDemoCounter(0);
    setLastPageId(null);
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: 0 }}>Tap2Fill</h1>
      <p style={{ opacity: 0.7, marginTop: 6 }}>Local-first (IndexedDB) snapshot + restore</p>

      <div style={{ border: "1px solid rgba(127,127,127,0.25)", borderRadius: 14, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Runtime</span>
          <strong>{runtimeLabel}</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, opacity: 0.8 }}>
          <span>initData length</span>
          <strong>{initDataLen}</strong>
        </div>

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
          Simulate Local Action (snapshot to IndexedDB)
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

        <button
          onClick={runSmokePutState}
          disabled={initDataLen === 0}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(127,127,127,0.35)",
            background: "transparent",
            fontWeight: 650,
            opacity: initDataLen === 0 ? 0.5 : 1,
          }}
        >
          Run Smoke Test (PUT /v1/me/state)
        </button>

        <pre style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(127,127,127,0.10)" }}>
          {out}
        </pre>
      </div>
    </div>
  );
}
