import { useEffect, useState } from "react";
import { isTma, tmaBootstrap } from "./lib/tma";
import { putMeState } from "./lib/api";

export default function App() {
  const [out, setOut] = useState("idle");

  useEffect(() => {
    tmaBootstrap();
  }, []);

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
      <p style={{ opacity: 0.7, marginTop: 6 }}>Runtime D1 auth/write smoke test</p>

      <button
        onClick={run}
        disabled={!isTma()}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(127,127,127,0.35)",
          background: "transparent",
          fontWeight: 650,
        }}
      >
        Run Smoke Test (PUT /v1/me/state)
      </button>

      {!isTma() && (
        <p style={{ marginTop: 10, opacity: 0.7 }}>
          Open inside Telegram Mini App to run (initData exists only there).
        </p>
      )}

      <pre style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(127,127,127,0.10)" }}>
        {out}
      </pre>
    </div>
  );
}
