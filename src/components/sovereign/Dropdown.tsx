"use client"

// Plain-Tailwind stand-in for the shadcn/ui DropdownMenu this section was
// built with upstream. No Radix — a click-outside-closes popover is enough
// for the row/toolbar "more actions" menus used across this section.
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export function Dropdown({
  trigger,
  align = "end",
  children,
}: {
  trigger: React.ReactNode
  align?: "start" | "end"
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <div
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {trigger}
      </div>
      {open && (
        <div
          className={cn(
            "absolute z-40 mt-2 w-48 rounded-lg border border-[#e2e2e2] bg-white py-1 shadow-lg",
            align === "end" ? "right-0" : "left-0"
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function DropdownItem({
  onClick,
  className = "",
  children,
}: {
  onClick?: (e: React.MouseEvent) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center px-3 py-2 text-left text-sm text-[#424656] transition-colors hover:bg-[#f8fafc]",
        className
      )}
    >
      {children}
    </button>
  )
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-[#e2e2e2]" />
}
