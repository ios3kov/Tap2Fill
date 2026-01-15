import { getMeState, hasTelegramInitData, type MeState } from "../lib/api";

export type RestoreResult =
  | { kind: "skipped"; reason: "no_init_data" }
  | { kind: "empty" }
  | { kind: "applied"; state: MeState }
  | { kind: "kept_local"; server: MeState };

export async function serverRestore(params: {
  localClientRev: number;
  onApply: (next: { lastPageId: string | null; clientRev: number }) => Promise<void> | void;
}): Promise<RestoreResult> {
  if (!hasTelegramInitData()) {
    return { kind: "skipped", reason: "no_init_data" };
  }

  const res = await getMeState();
  const server = res.state;

  if (!server) return { kind: "empty" };

  // Policy: server is "backup + cross-device". If server clientRev is newer, apply it.
  if (server.clientRev > params.localClientRev) {
    await params.onApply({ lastPageId: server.lastPageId, clientRev: server.clientRev });
    return { kind: "applied", state: server };
  }

  return { kind: "kept_local", server };
}