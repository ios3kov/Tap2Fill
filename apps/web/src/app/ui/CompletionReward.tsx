// apps/web/src/app/ui/CompletionReward.tsx
import { useEffect, useMemo } from "react"

export type CompletionRewardProps = Readonly<{
  open: boolean

  /**
   * Optional percent to display (0..100). If omitted, it's not shown.
   * App.tsx currently passes this.
   */
  percent?: number

  title?: string // default: "Completed!"
  subtitle?: string // optional

  /**
   * Primary CTA (e.g., "Next page").
   * App.tsx currently passes onNext().
   */
  nextLabel?: string // default: "Next"
  onNext?: () => void
  nextDisabled?: boolean

  /**
   * Secondary CTA (e.g., "Back to Gallery").
   * App.tsx currently passes onBack().
   */
  backLabel?: string // default: "Back to Gallery"
  onBack?: () => void

  /**
   * Close affordance (optional). If omitted, close is only via CTAs.
   */
  onClose?: () => void

  /**
   * Auto-dismiss after delay (ms). Set null/undefined to disable.
   * Recommended: 1800–3000ms if you still show CTAs underneath.
   */
  autoCloseMs?: number | null

  /**
   * Accessibility: label for the dialog.
   */
  ariaLabel?: string // default based on title
}>

/**
 * CompletionReward — CSS-only celebratory overlay (confetti + subtle glow) with CTAs.
 *
 * Design goals:
 * - No heavy deps, no canvas.
 * - Deterministic output, bounded DOM.
 * - Theme-aware via Telegram CSS variables.
 * - No setState-in-effect (lint-clean), no conditional hooks.
 */
export function CompletionReward(props: CompletionRewardProps) {
  const {
    open,
    percent,
    title = "Completed!",
    subtitle,
    nextLabel = "Next",
    onNext,
    nextDisabled = false,
    backLabel = "Back to Gallery",
    onBack,
    onClose,
    autoCloseMs = null,
    ariaLabel,
  } = props

  // Accessibility label (stable, safe).
  const label = useMemo(() => {
    const t = typeof title === "string" ? title.trim() : ""
    return ariaLabel ?? (t ? `Completion: ${t}` : "Completion reward")
  }, [ariaLabel, title])

  // Optional auto-close (no setState; only calls callback).
  useEffect(() => {
    if (!open) return
    if (autoCloseMs === null || autoCloseMs === undefined) return

    const ms = Number.isFinite(autoCloseMs)
      ? Math.max(600, Math.min(8000, Math.trunc(autoCloseMs)))
      : 2000

    const id = window.setTimeout(() => {
      onClose?.()
    }, ms)

    return () => window.clearTimeout(id)
  }, [open, autoCloseMs, onClose])

  // Confetti pieces are deterministic and bounded; animation restarts naturally on mount (open toggles).
  const pieces = useMemo(() => {
    const N = 24
    const out: Array<{
      i: number
      left: number
      delayMs: number
      durMs: number
      rotDeg: number
      sizePx: number
      hue: number
    }> = []

    for (let i = 0; i < N; i++) {
      // Deterministic pseudo-random from index (stable in tests; no Math.random).
      const seed = (i * 9301 + 49297) % 233280
      const r = seed / 233280

      const left = Math.round((i / Math.max(1, N - 1)) * 96 + (r - 0.5) * 6)
      const delayMs = Math.round((r * 0.22 + (i % 6) * 0.03) * 1000)
      const durMs = Math.round((1.1 + (i % 5) * 0.18 + r * 0.2) * 1000)
      const rotDeg = Math.round((r * 720 - 360) * 10) / 10
      const sizePx = Math.round((6 + (i % 4) * 2 + r * 2) * 10) / 10
      const hue = Math.round((i * 29 + r * 40) % 360)

      out.push({ i, left, delayMs, durMs, rotDeg, sizePx, hue })
    }

    return out
  }, [])

  const safePercent = useMemo(() => {
    if (typeof percent !== "number" || !Number.isFinite(percent)) return null
    const p = Math.max(0, Math.min(100, Math.round(percent)))
    return p
  }, [percent])

  if (!open) return null

  const bg = "rgba(0,0,0,0.45)"
  const cardBg = "var(--tg-theme-bg-color, #ffffff)"
  const cardFg = "var(--tg-theme-text-color, #111111)"
  const muted = "var(--tg-theme-hint-color, rgba(0,0,0,0.55))"
  const btnBg = "var(--tg-theme-button-color, #1E90FF)"
  const btnFg = "var(--tg-theme-button-text-color, #ffffff)"
  const border = "rgba(255,255,255,0.12)"

  const canNext = typeof onNext === "function" && !nextDisabled

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding:
          "max(env(safe-area-inset-top), 12px) max(env(safe-area-inset-right), 12px) max(env(safe-area-inset-bottom), 12px) max(env(safe-area-inset-left), 12px)",
        background: bg,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "min(92vw, 520px)",
          borderRadius: 16,
          background: cardBg,
          color: cardFg,
          border: `1px solid ${border}`,
          boxShadow: "0 22px 52px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Confetti layer */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <div className="t2f-cr-glow" />
          {pieces.map((p) => (
            <span
              key={p.i}
              className="t2f-cr-confetti"
              style={{
                left: `${p.left}%`,
                width: `${p.sizePx}px`,
                height: `${Math.max(8, p.sizePx * 1.6)}px`,
                background: `hsl(${p.hue} 90% 55%)`,
                animationDelay: `${p.delayMs}ms`,
                animationDuration: `${p.durMs}ms`,
                transform: `translateY(-18px) rotate(${p.rotDeg}deg)`,
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div style={{ position: "relative", padding: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(46, 213, 115, 0.12)",
                display: "grid",
                placeItems: "center",
                border: "1px solid rgba(46, 213, 115, 0.18)",
                flex: "0 0 auto",
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>✓</span>
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}
              >
                {title}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  color: muted,
                  lineHeight: 1.35,
                }}
              >
                {subtitle ? subtitle : "Your coloring is complete."}
                {safePercent !== null ? (
                  <span style={{ marginLeft: 8, opacity: 0.9 }}>
                    ({safePercent}%)
                  </span>
                ) : null}
              </div>
            </div>

            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  marginLeft: "auto",
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "transparent",
                  color: cardFg,
                  borderRadius: 10,
                  padding: "6px 9px",
                  cursor: "pointer",
                  opacity: 0.8,
                }}
              >
                ✕
              </button>
            ) : null}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => onBack?.()}
              style={{
                flex: "1 1 160px",
                borderRadius: 12,
                padding: "10px 12px",
                border: "1px solid rgba(0,0,0,0.12)",
                background: "rgba(0,0,0,0.04)",
                color: cardFg,
                fontWeight: 800,
                cursor: typeof onBack === "function" ? "pointer" : "default",
                opacity: typeof onBack === "function" ? 1 : 0.7,
              }}
            >
              {backLabel}
            </button>

            <button
              type="button"
              onClick={() => onNext?.()}
              disabled={!canNext}
              style={{
                flex: "1 1 160px",
                borderRadius: 12,
                padding: "10px 12px",
                border: "1px solid rgba(255,255,255,0.10)",
                background: btnBg,
                color: btnFg,
                fontWeight: 900,
                cursor: canNext ? "pointer" : "not-allowed",
                opacity: canNext ? 1 : 0.55,
              }}
            >
              {nextLabel}
            </button>
          </div>

          <div
            style={{ marginTop: 10, fontSize: 12, color: muted, opacity: 0.9 }}
          >
            Tip: You can keep exploring more pages from the gallery.
          </div>
        </div>

        {/* Local component CSS (no external file required) */}
        <style>{`
          .t2f-cr-glow {
            position: absolute;
            inset: -40% -20%;
            background: radial-gradient(circle at 50% 50%, rgba(46,213,115,0.22), rgba(0,0,0,0) 55%);
            animation: t2f-cr-glow 1200ms ease-out forwards;
            transform: translate3d(0,0,0);
          }

          .t2f-cr-confetti {
            position: absolute;
            top: 0;
            border-radius: 2px;
            opacity: 0.95;
            filter: drop-shadow(0 10px 18px rgba(0,0,0,0.18));
            transform-origin: center;
            animation-name: t2f-cr-fall;
            animation-timing-function: cubic-bezier(0.25, 0.8, 0.2, 1);
            animation-fill-mode: forwards;
            will-change: transform, opacity;
          }

          @keyframes t2f-cr-glow {
            0%   { opacity: 0; transform: scale(0.92); }
            35%  { opacity: 1; transform: scale(1.0); }
            100% { opacity: 0; transform: scale(1.06); }
          }

          @keyframes t2f-cr-fall {
            0%   { transform: translate3d(0, -18px, 0) rotate(0deg); opacity: 0; }
            12%  { opacity: 1; }
            100% { transform: translate3d(0, 520px, 0) rotate(540deg); opacity: 0; }
          }

          @media (prefers-reduced-motion: reduce) {
            .t2f-cr-glow,
            .t2f-cr-confetti {
              animation: none !important;
              opacity: 0 !important;
            }
          }
        `}</style>
      </div>
    </div>
  )
}
