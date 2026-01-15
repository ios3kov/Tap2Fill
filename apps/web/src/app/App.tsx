import { useEffect } from "react";
import { isTma, tmaBootstrap } from "../lib/tma";
import styles from "./App.module.css";

export function App() {
  useEffect(() => {
    tmaBootstrap();
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.title}>Tap2Fill</div>
        <div className={styles.subtitle}>Cozy tap-to-fill coloring</div>
      </header>

      <main className={styles.main}>
        <section className={styles.card}>
          <div className={styles.row}>
            <span>Runtime</span>
            <strong>{isTma() ? "Telegram Mini App" : "Web (standalone)"}</strong>
          </div>

          <div className={styles.note}>
            This is a bootstrap screen. Next milestone: Gallery → Canvas (SVG tap-to-fill) with local-first saves.
          </div>
        </section>
      </main>
    </div>
  );
}
