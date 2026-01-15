declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

export function isTma(): boolean {
  return Boolean(window.Telegram?.WebApp);
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
}

export function tmaBootstrap(): void {
  const wa = window.Telegram?.WebApp;
  if (!wa) return;
  try {
    wa.ready?.();
    wa.expand?.();
  } catch {
    // no-op: defensive; TMA APIs differ across clients
  }
}
