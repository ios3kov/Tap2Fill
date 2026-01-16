// apps/web/src/app/ui/ConfirmModal.tsx
import type React from "react"
import { useEffect, useId, useMemo, useRef } from "react"

export type ConfirmVariant = "danger" | "default"

export type ConfirmModalProps = Readonly<{
  open: boolean

  title: string
  description?: string

  // Back-compat aliases (older App.tsx integrations)
  message?: string
  danger?: boolean

  confirmText?: string // default: "Confirm"
  cancelText?: string // default: "Cancel"
  variant?: ConfirmVariant // default: "default"

  closeOnBackdrop?: boolean
  busy?: boolean

  onConfirm: () => void | Promise<void>

  /**
   * Called when user cancels/closes.
   * IMPORTANT: Parent must set `open=false`.
   */
  onClose: () => void
}>

export function ConfirmModal(props: ConfirmModalProps) {
  const {
    open,
    title,
    description,
    message,
    danger,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = danger ? "danger" : "default",
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

  const resolvedDescription = useMemo(() => {
    const d = typeof description === "string" ? description.trim() : ""
    if (d) return d
    const m = typeof message === "string" ? message.trim() : ""
    return m || undefined
  }, [description, message])

  const hasDescription = useMemo(() => {
    return (
      typeof resolvedDescription === "string" &&
      resolvedDescription.trim().length > 0
    )
  }, [resolvedDescription])

  useEffect(() => {
    if (!open) return
    lastActiveElRef.current =
      (document.activeElement as HTMLElement | null) ?? null
    const id = window.setTimeout(() => {
      cancelBtnRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (open) return
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
      // Swallow: parent decides error surface & open state.
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
              {resolvedDescription}
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
