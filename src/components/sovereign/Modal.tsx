"use client"

// Plain-Tailwind stand-in for the shadcn/ui Dialog this section was built
// with upstream (see sovereign section import note in AGENTS.md/README of
// the port). No Radix, no portal — a controlled overlay is enough for the
// confirm/preview/form dialogs used across this section.
import { useEffect } from "react"

export function Modal({
  open,
  onClose,
  title,
  description,
  className = "",
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  className?: string
  footer?: React.ReactNode
  children?: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`relative w-full max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-lg ${
          className || "max-w-md"
        }`}
      >
        {(title || description) && (
          <div className="mb-4">
            {title && <h2 className="text-lg font-semibold text-[#0f172a]">{title}</h2>}
            {description && <p className="mt-1 text-sm text-[#64748b]">{description}</p>}
          </div>
        )}
        {children}
        {footer && <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
