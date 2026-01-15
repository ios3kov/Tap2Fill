export type TmaWebApp = {
  ready: () => void;
  expand: () => void;
  initData?: string;
};

export function getWebApp(): TmaWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TmaWebApp } };
  return w.Telegram?.WebApp ?? null;
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
    // no-op
  }
}
