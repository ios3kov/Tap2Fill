// apps/web/src/lib/tma.ts
/* Minimal, robust Telegram Mini App bootstrap:
   - WebApp.ready() + expand()
   - theme params -> CSS vars
   - safe height via --tg-vh (visualViewport-aware)
*/

type TgThemeParams = Record<string, string | undefined>;

type TgWebApp = {
  initData?: string;
  themeParams?: TgThemeParams;
  ready?: () => void;
  expand?: () => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
};

type TgRoot = { WebApp?: TgWebApp };

function getTg(): TgRoot | null {
  const w = window as unknown as { Telegram?: TgRoot };
  return w.Telegram ?? null;
}

export function isTma(): boolean {
  return Boolean(getTg()?.WebApp);
}

export function getInitData(): string {
  const v = getTg()?.WebApp?.initData ?? "";
  return typeof v === "string" ? v : "";
}

function setCssVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function updateTgVh() {
  // Prefer visualViewport for iOS/Telegram in-app viewport correctness.
  const h = window.visualViewport?.height ?? window.innerHeight;
  setCssVar("--tg-vh", `${Math.max(1, Math.floor(h))}px`);
}

function applyThemeVars(theme?: TgThemeParams) {
  if (!theme) return;

  // Telegram provides keys like: bg_color, text_color, hint_color, button_color, button_text_color, etc.
  // We expose them as CSS vars in a predictable format: --tg-theme-<key>
  for (const [k, v] of Object.entries(theme)) {
    if (!v) continue;
    setCssVar(`--tg-theme-${k.replaceAll("_", "-")}`, v);
  }
}

/**
 * Call once on app mount.
 * Safe in non-TMA (no-op).
 */
export function tmaBootstrap() {
  updateTgVh();

  const tg = getTg()?.WebApp;
  if (tg) {
    try {
      tg.ready?.();
      tg.expand?.();
    } catch {
      // Never hard-fail bootstrap.
    }
    applyThemeVars(tg.themeParams);
  }

  const onResize = () => updateTgVh();
  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", onResize);

  const onThemeChanged = () => {
    const t = getTg()?.WebApp?.themeParams;
    applyThemeVars(t);
  };

  // Telegram events (best-effort)
  try {
    tg?.onEvent?.("themeChanged", onThemeChanged);
    tg?.onEvent?.("viewportChanged", onResize);
  } catch {
    // ignore
  }

  return () => {
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    try {
      tg?.offEvent?.("themeChanged", onThemeChanged);
      tg?.offEvent?.("viewportChanged", onResize);
    } catch {
      // ignore
    }
  };
}