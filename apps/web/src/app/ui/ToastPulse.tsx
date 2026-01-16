// apps/web/src/app/ui/ToastPulse.tsx
import { useMemo } from "react"

export type ToastKind = "saved" | "completed" | "info" | "error"

export type ToastPulseProps = Readonly<{
  /**
   * Provide a changing token (number/string) to trigger a pulse.
   * Example: token={saveAckRev} or token={`${pageId}:${clientRev}`}
   */
  token: string | number | null | undefined

  kind?: ToastKind // default: "info"
  message?: string // default based on kind

  /**
   * Auto-hide duration. Keep short: this is a "pulse", not a snackbar.
   */
  durationMs?: number // default: 900

  /**
   * Optional: anchor position. Defaults to top-center (safe-area aware).
   */
  position?: "top" | "bottom" // default: "top"

  /**
   * If true, hides while user is gesturing (useful for zoom/pan).
   */
  suppress?: boolean

  /**
   * Optional click handler (e.g., open "Details" or "Undo").
   */
  onClick?: () => void

  /**
   * For accessibility. Default is polite.
   */
  ariaLive?: "polite" | "assertive" | "off"
}>

/**
 * ToastPulse — micro feedback ("Saved", "Completed") without a persistent "Saving..." state.
 *
 * Implementation notes:
 * - No internal state and no effects => lint-clean (no setState-in-effect).
 * - Animation restarts on token change via key={token}.
 * - Auto-hide is handled by CSS keyframes ending at opacity: 0.
 */
export function ToastPulse(props: ToastPulseProps) {
  const {
    token,
    kind = "info",
    message,
    durationMs = 900,
    position = "top",
    suppress = false,
    onClick,
    ariaLive = "polite",
  } = props

  const resolvedMessage = useMemo(() => {
    if (typeof message === "string" && message.trim().length > 0)
      return message.trim()
    switch (kind) {
      case "saved":
        return "Saved"
      case "completed":
        return "Completed"
      case "error":
        return "Something went wrong"
      default:
        return "Done"
    }
  }, [kind, message])

  const ms = useMemo(() => {
    const n = typeof durationMs === "number" ? durationMs : Number(durationMs)
    if (!Number.isFinite(n)) return 900
    return Math.max(200, Math.min(5000, Math.trunc(n)))
  }, [durationMs])

  const isBottom = position === "bottom"
  const isClickable = typeof onClick === "function"

  if (suppress) return null
  if (token === null || token === undefined) return null

  const bg =
    kind === "error"
      ? "rgba(209, 26, 42, 0.95)"
      : kind === "completed"
        ? "rgba(46, 213, 115, 0.92)"
        : "rgba(0, 0, 0, 0.72)"

  const fg = "#fff"

  return (
    <div
      key={String(token)}
      aria-live={ariaLive}
      role={ariaLive === "off" ? undefined : "status"}
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        top: isBottom
          ? undefined
          : `calc(max(env(safe-area-inset-top), 10px) + 4px)`,
        bottom: isBottom
          ? `calc(max(env(safe-area-inset-bottom), 10px) + 4px)`
          : undefined,
        zIndex: 9998,
        pointerEvents: isClickable ? "auto" : "none",
      }}
    >
      <div
        onClick={() => {
          if (!isClickable) return
          onClick?.()
        }}
        style={{
          userSelect: "none",
          cursor: isClickable ? "pointer" : "default",
          padding: "8px 12px",
          borderRadius: 999,
          background: bg,
          color: fg,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.1,
          boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(6px)",
          maxWidth: "min(92vw, 520px)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          animation: `t2f-toast-pulse ${ms}ms cubic-bezier(0.2, 0.9, 0.2, 1) forwards`,
          willChange: "transform, opacity",
        }}
      >
        {resolvedMessage}
      </div>

      <style>{`
        @keyframes t2f-toast-pulse {
          0%   { opacity: 0; transform: translateY(-6px); }
          12%  { opacity: 1; transform: translateY(0); }
          78%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-2px); }
        }

        @media (prefers-reduced-motion: reduce) {
          div[style*="t2f-toast-pulse"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}
