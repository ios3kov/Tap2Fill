import { getInitData } from "./tma";

const API_BASE = "https://tap2fill-worker.os3kov.workers.dev";

type Json = Record<string, unknown>;

async function httpJson<T extends Json>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-tg-init-data": getInitData(),
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

export function putMeState(lastPageId: string | null) {
  return httpJson<{ ok: true; state: unknown }>("/v1/me/state", {
    method: "PUT",
    body: JSON.stringify({ lastPageId }),
  });
}
