// apps/web/src/app/config/appConfig.ts
export const APP_CONFIG = {
  ui: {
    bootstrapTickMs: 250,
    bootstrapTickTotalMs: 3000,
    pointer: {
      touchDebounceMs: 60,
    },
  },
  network: {
    flushDelayMs: 600,
  },
  limits: {
    pageIdMaxLen: 64,
    undoStackMax: 64,
    fillMapMaxEntries: 20_000,
    keyMaxLen: 64,
    valueMaxLen: 64,
  },
} as const
