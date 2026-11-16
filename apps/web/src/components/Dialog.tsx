// SPDX-License-Identifier: AGPL-3.0-only
// Modal dialog on the design's `.ovl` / `.mdl` classes: traps focus, closes on Escape and on a
// completed click outside, and returns focus to whatever opened it.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** id of the element that titles the dialog. */
  labelledBy: string;
  size?: "md" | "lg";
  /** Style for the overlay, e.g. a different top offset. */
  overlayStyle?: CSSProperties;
  children: ReactNode;
}

export function Dialog({ open, onClose, labelledBy, size = "md", overlayStyle, children }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Who opened the dialog, read as it opens: a field inside with autoFocus takes focus before any
  // effect runs, so reading it in the effect would remember that field (gone after closing) and
  // focus would fall to the page instead of returning to the opener (WCAG 2.4.3).
  const opener = useRef<HTMLElement | null>(null);
  const pressedOutside = useRef(false);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const returnTo = opener.current;
    const node = panel.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // Keep a field the dialog focused itself (autoFocus); otherwise start at the first control.
    if (!node?.contains(document.activeElement)) (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return e.preventDefault();
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="ovl"
      style={overlayStyle}
      // Closes on a completed click outside the panel, not on the press (WCAG 2.5.2): a press that
      // starts outside and is released inside, or the other way round, closes nothing.
      onMouseDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (!(pressedOutside.current && e.target === e.currentTarget)) pressedOutside.current = false;
      }}
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget) onClose();
        pressedOutside.current = false;
      }}
    >
      <div
        ref={panel}
        className={size === "lg" ? "mdl mdl-lg" : "mdl"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
