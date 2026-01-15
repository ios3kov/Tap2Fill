import { useEffect, useMemo, useState } from "react";
import { getInitData, isTma, tmaBootstrap } from "./lib/tma";
import { putMeState } from "./lib/api";

export default function App() {
  const [out, setOut] = useState("idle");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    tmaBootstrap();
    // Telegram object can appear shortly after load on some clients.
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    window.setTimeout(() => window.clearInterval(id), 3000);
    return () => window.clearInterval(id);
  }, []);

  const initDataLen = useMemo(() => getInitData().length, [tick]);
  const runtimeLabel = isTma() ? "Telegram Mini App" : "Web (standalone)";

  async function run() {
    setOut("calling...");
    try {
      const res = await putMeState("page_demo_1");
      setOut(`OK: ${JSON.stringify(res)}`);
    } catch (e) {
      setOut(`ERR: ${(e as Error).message}`);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: 0 }}>Tap2Fill</h1>
      <p style={{ opacity: 0.7, marginTop: 6 }}>D1 runtime auth/write smoke test</p>

      <div style={{ border: "1px solid rgba(127,127,127,0.25)", borderRadius: 14, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Runtime</span>
          <strong>{runtimeLabel}</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, opacity: 0.8 }}>
          <span>initData length</span>
          <strong>{initDataLen}</strong>
        </div>

        <button
          onClick={run}
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

        {initDataLen === 0 && (
          <p style={{ marginTop: 10, opacity: 0.75 }}>
            initData is empty. If you are in Telegram, it usually means telegram-web-app.js was not loaded or the WebApp
            object did not initialize.
          </p>
        )}

        <pre style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(127,127,127,0.10)" }}>
          {out}
        </pre>
      </div>
    </div>
  );
}
