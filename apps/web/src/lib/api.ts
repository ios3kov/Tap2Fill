type TgWebApp = {
  initData?: string;
};

function getInitData(): string {
  const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  return String(wa?.initData ?? "");
}

function getApiBase(): string {
  // In production, call the Worker directly.
  // (You can later route through Pages via proxy if desired.)
  return "https://tap2fill-worker.os3kov.workers.dev";
}

export async function putMeState(lastPageId: string | null): Promise<unknown> {
  const initData = getInitData();
  const res = await fetch(`${getApiBase()}/v1/me/state`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-tg-init-data": initData,
    },
    body: JSON.stringify({ lastPageId }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PUT /v1/me/state failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}
