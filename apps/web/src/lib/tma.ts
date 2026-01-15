export type TmaThemeParams = Record<string, string>;

export type TmaWebApp = {
  ready: () => void;
  expand: () => void;
  initData?: string;
  themeParams?: TmaThemeParams;
};

export type TmaWindow = {
  Telegram?: {
    WebApp?: TmaWebApp;
  };
};

function getWindow(): TmaWindow {
  return window as unknown as TmaWindow;
}

export function getWebApp(): TmaWebApp | null {
  return getWindow().Telegram?.WebApp ?? null;
}

export function isTma(): boolean {
  return Boolean(getWebApp());
}

export function tmaBootstrap(): void {
  const wa = getWebApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
  } catch {
    // Never crash the app due to Telegram bridge issues.
  }
}
