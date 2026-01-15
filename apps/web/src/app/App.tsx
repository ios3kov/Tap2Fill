import { useEffect, useState } from "react";
import { tmaBootstrap, isTma } from "../lib/tma";
import { putMeState } from "../lib/api";
import styles from "./App.module.css";

export function App() {
  const [status, setStatus] = useState<string>("idle");

  useEffect(() => {
    tmaBootstrap();
  }, []);

  async function onSmokeTest() {
    setStatus("calling...");
    try {
      const payload = await putMeState("page_demo_1");
      setStatus(`OK: ${JSON.stringify(payload)}`);
    } catch (e) {
      setStatus(`ERR: ${(e as Error).message}`);
    }
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.title}>Tap2Fill</div>
        <div className={styles.subtitle}>D1 runtime auth/write smoke test</div>
      </header>

      <main className={styles.main}>
        <section className={styles.card}>
          <div className={styles.row}>
            <span>Runtime</span>
            <strong>{isTma() ? "Telegram Mini App" : "Web (standalone)"}</strong>
          </div>

          <button className={styles.button} type="button" onClick={onSmokeTest} disabled={!isTma()}>
            Run D1 Smoke Test (PUT /v1/me/state)
          </button>

          {!isTma() && (
            <div className={styles.note}>
              Open this page inside Telegram Mini App to run the test (initData is only available there).
            </div>
          )}

          <pre className={styles.pre}>{status}</pre>
        </section>
      </main>
    </div>
  );
}
