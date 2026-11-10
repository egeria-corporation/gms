// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/browser.ts";

/**
 * Copies a value and confirms it in place: the label reads "Copied" for two seconds and the
 * change is announced to screen readers. When copying is refused it says so instead of failing silently.
 */
export function CopyButton({ value, label = "Copy", what, className = "btn btn-secondary", onCopied }: { value: string; label?: string; what: string; className?: string; onCopied?: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const text = state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select and copy" : label;
  return (
    <button
      type="button"
      className={className}
      aria-label={state === "idle" ? `Copy ${what}` : undefined}
      onClick={async () => {
        const ok = await copyText(value);
        setState(ok ? "copied" : "failed");
        if (ok) onCopied?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? <Check className="ic" aria-hidden="true" /> : <Copy className="ic" aria-hidden="true" />}
      <span aria-live="polite">{text}</span>
    </button>
  );
}
