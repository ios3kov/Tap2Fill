import { getWebApp } from "./tma";

function getInitData(): string {
  return String(getWebApp()?.initData ?? "");
}

function apiBase(): string {
  return "https://tap2fill-worker.os3kov.workers.dev";
}

export async function putMeState(lastPageId: string | null): Promise<unknown> {
  const res = await fetch(`${apiBase()}/v1/me/state`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-tg-init-data": getInitData(),
    },
    body: JSON.stringify({ lastPageId }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return json;
}
