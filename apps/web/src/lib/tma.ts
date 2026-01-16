// apps/web/src/lib/tma.ts
/* Minimal, robust Telegram Mini App bootstrap:
   - WebApp.ready() + WebApp.expand()
   - theme params -> CSS vars (--tg-theme-*)
   - safe height via --tg-vh (visualViewport-aware)
   - idempotent, safe in non-TMA (no-op)
*/

export type TgThemeParams = Record<string, string | undefined>;

export type TgWebApp = {
  initData?: string;
  themeParams?: TgThemeParams;
  colorScheme?: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
};

type TgRoot = { WebApp?: TgWebApp };

type TelegramWindow = Window & { Telegram?: TgRoot };

function getTg(): TgRoot | null {
  const ww = window as TelegramWindow;
  return ww.Telegram ?? null;
}

export function isTma(): boolean {
  return Boolean(getTg()?.WebApp);
}

export function getInitData(): string {
  const v = getTg()?.WebApp?.initData ?? "";
  return typeof v === "string" ? v.trim() : "";
}

function setCssVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function normalizeThemeKey(k: string): string {
  // Telegram provides snake_case keys; expose as kebab-case.
  // Keep it predictable and stable.
  return k.replaceAll("_", "-").trim();
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
    const val = typeof v === "string" ? v.trim() : "";
    if (!val) continue;
    setCssVar(`--tg-theme-${normalizeThemeKey(k)}`, val);
  }
}

function applyColorSchemeHint(scheme?: "light" | "dark") {
  // Optional but useful for CSS selectors and future theming.
  // No security impact; safe in all contexts.
  const root = document.documentElement;
  root.setAttribute("data-tg-scheme", scheme === "dark" ? "dark" : "light");
}

export type TmaCleanup = () => void;

/**
 * Call once on app mount.
 * Safe in non-TMA (no-op).
 *
 * Returns cleanup for installed listeners.
 */
export function tmaBootstrap(): TmaCleanup {
  updateTgVh();

  const tg = getTg()?.WebApp;

  // Best-effort Telegram calls (never hard-fail).
  if (tg) {
    try {
      tg.ready?.();
    } catch {
      // ignore
    }
    try {
      tg.expand?.();
    } catch {
      // ignore
    }

    applyThemeVars(tg.themeParams);
    applyColorSchemeHint(tg.colorScheme);
  } else {
    // In non-TMA we still set a sane default for predictable styling.
    applyColorSchemeHint("light");
  }

  const onResize = () => updateTgVh();

  // Window resize + visualViewport resize for best coverage.
  window.addEventListener("resize", onResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onResize, { passive: true });

  const onThemeChanged = () => {
    const wa = getTg()?.WebApp;
    applyThemeVars(wa?.themeParams);
    applyColorSchemeHint(wa?.colorScheme);
    // Some clients adjust chrome on theme change; keep vh fresh.
    updateTgVh();
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