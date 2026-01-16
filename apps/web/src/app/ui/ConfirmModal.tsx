// apps/web/src/app/ui/ConfirmModal.tsx
import { useEffect, useId, useMemo, useRef } from "react"

export type ConfirmVariant = "danger" | "default"

export type ConfirmModalProps = Readonly<{
  open: boolean

  title: string
  description?: string

  confirmText?: string // default: "Confirm"
  cancelText?: string // default: "Cancel"
  variant?: ConfirmVariant // default: "default"

  /**
   * If true, clicking backdrop closes the modal (ESC still works).
   * For destructive actions you usually want false.
   */
  closeOnBackdrop?: boolean

  /**
   * Prevent closing while async work is running.
   * Disables buttons and blocks Escape/backdrop close.
   */
  busy?: boolean

  /**
   * Called when user confirms. If you return a Promise, you can set `busy`
   * in the parent to lock the UI until it resolves.
   */
  onConfirm: () => void | Promise<void>

  /**
   * Called when user cancels/closes.
   * IMPORTANT: Parent must set `open=false`.
   */
  onClose: () => void

  /**
   * Optional: provide a DOM element to portal into later.
   * For now we render inline to keep dependencies minimal.
   */
}>

/**
 * ConfirmModal — a lightweight, dependency-free confirm dialog.
 *
 * Accessibility:
 * - role="dialog", aria-modal, labelledby/describe.
 * - Focus management: initial focus to Cancel (safer), restore focus on close.
 * - Escape to close (unless busy).
 *
 * Safety:
 * - No dangerouslySetInnerHTML.
 * - Defensive event handling (no accidental propagation).
 *
 * Styling:
 * - Inline styles are intentionally minimal and theme-aware via Telegram vars.
 * - You may move styles to CSS later without changing the API.
 */
export function ConfirmModal(props: ConfirmModalProps) {
  const {
    open,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "default",
    closeOnBackdrop = false,
    busy = false,
    onConfirm,
    onClose,
  } = props

  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const lastActiveElRef = useRef<HTMLElement | null>(null)

  const hasDescription = useMemo(
    () => typeof description === "string" && description.trim().length > 0,
    [description],
  )

  // Focus: capture last active element; focus cancel on open; restore on close.
  useEffect(() => {
    if (!open) return

    lastActiveElRef.current =
      (document.activeElement as HTMLElement | null) ?? null

    // Defer focus until mounted.
    const id = window.setTimeout(() => {
      cancelBtnRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(id)
    }
  }, [open])

  useEffect(() => {
    if (open) return

    // Restore focus only when we were previously open.
    const el = lastActiveElRef.current
    if (el && typeof el.focus === "function") {
      try {
        el.focus()
      } catch {
        // ignore
      }
    }
    lastActiveElRef.current = null
  }, [open])

  // ESC to close.
  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (busy) return
      e.preventDefault()
      onClose()
    }

    window.addEventListener("keydown", onKeyDown, { passive: false })
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, busy, onClose])

  if (!open) return null

  function stop(e: React.SyntheticEvent) {
    e.stopPropagation()
  }

  function onBackdropClick() {
    if (busy) return
    if (!closeOnBackdrop) return
    onClose()
  }

  async function handleConfirm() {
    if (busy) return
    try {
      await onConfirm()
    } catch {
      // Intentionally swallow here; the parent can surface errors as desired.
      // Keeping the modal open is the parent's responsibility via `open` prop.
    }
  }

  const isDanger = variant === "danger"

  return (
    <div
      onMouseDown={onBackdropClick}
      onTouchStart={onBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(env(safe-area-inset-top), 16px) max(env(safe-area-inset-right), 16px) max(env(safe-area-inset-bottom), 16px) max(env(safe-area-inset-left), 16px)",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
      }}
      aria-hidden={false}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasDescription ? descId : undefined}
        onMouseDown={stop}
        onTouchStart={stop}
        style={{
          width: "min(92vw, 420px)",
          borderRadius: 14,
          background: "var(--tg-theme-bg-color, #fff)",
          color: "var(--tg-theme-text-color, #111)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          border: "1px solid rgba(0,0,0,0.06)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 16 }}>
          <div
            id={titleId}
            style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}
          >
            {title}
          </div>

          {hasDescription && (
            <div
              id={descId}
              style={{
                marginTop: 8,
                fontSize: 13,
                lineHeight: 1.35,
                opacity: 0.85,
              }}
            >
              {description}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            padding: 16,
            borderTop: "1px solid rgba(0,0,0,0.08)",
            background: "rgba(0,0,0,0.02)",
          }}
        >
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={() => {
              if (busy) return
              onClose()
            }}
            disabled={busy}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "transparent",
              color: "var(--tg-theme-text-color, #111)",
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {cancelText}
          </button>

          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: isDanger
                ? "var(--tg-theme-destructive-text-color, #d11a2a)"
                : "var(--tg-theme-button-color, #2ea6ff)",
              color: isDanger
                ? "#fff"
                : "var(--tg-theme-button-text-color, #fff)",
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
              minWidth: 110,
            }}
          >
            {busy ? "Working…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
