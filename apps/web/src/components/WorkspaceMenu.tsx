// SPDX-License-Identifier: AGPL-3.0-only
// Workspace switcher: the top bar's workspace button and the menu it opens (design board P5).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Check, ChevronDown, LogOut, Plus } from "lucide-react";
import { roleTitle, type MeWorkspace } from "../api/client.ts";
import { useServices } from "../app/services.tsx";

function acronym(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .join("")
    .slice(0, 4);
}

function Item({ ws, current, onPick }: { ws: MeWorkspace; current: boolean; onPick: () => void }) {
  const funder = ws.kind === "funder";
  return (
    <li>
      <Link
        to={`/w/${ws.handle}`}
        role="menuitem"
        aria-current={current ? "true" : undefined}
        onClick={onPick}
        style={{
          display: "grid",
          gridTemplateColumns: "36px minmax(0, 1fr) auto",
          gap: "12px",
          alignItems: "center",
          padding: "10px",
          borderRadius: "8px",
          textDecoration: "none",
          color: "inherit",
          background: current ? "var(--og-teal-soft)" : undefined,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: funder ? "var(--og-navy-dark)" : "var(--og-blue-light)",
            color: funder ? "var(--og-white)" : "var(--s-info-fg)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            fontWeight: 800,
            letterSpacing: ".04em",
          }}
        >
          {acronym(ws.name)}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
          <span className="b" style={{ color: "var(--og-navy-dark)" }}>
            {ws.name}
          </span>
          <span className="small muted">
            {current ? "Current · " : ""}
            {roleTitle(ws.role)}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="role">{funder ? "Funder" : "Applicant"}</span>
          {current && <Check className="ic" aria-hidden="true" style={{ color: "var(--og-teal-dark)" }} />}
        </span>
      </Link>
    </li>
  );
}

export function WorkspaceMenu({ currentHandle, children }: { currentHandle: string; children: ReactNode }) {
  const { meState, auth } = useServices();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const me = meState.status === "ready" ? meState.me : null;
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={button}
        type="button"
        className="ws"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="ws-menu"
        onClick={() => setOpen((v) => !v)}
      >
        {children}
        <ChevronDown className="ic" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="ovl" style={{ padding: 0, background: "rgba(13,42,67,.35)" }} onMouseDown={() => setOpen(false)} />
          <div
            ref={menu}
            id="ws-menu"
            role="menu"
            aria-label="Switch workspace"
            className="card"
            style={{
              position: "absolute",
              top: "44px",
              left: 0,
              zIndex: 6,
              width: "440px",
              maxWidth: "calc(100vw - 32px)",
              boxShadow: "0 24px 64px rgba(13,42,67,.3)",
              overflow: "hidden",
              fontWeight: 400,
            }}
          >
            <div
              style={{
                padding: "14px 16px 10px",
                borderBottom: "1px solid var(--og-gray-200)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span className="eyebrow">Your workspaces</span>
              <span className="small muted">{me?.email}</span>
            </div>
            <ul style={{ display: "flex", flexDirection: "column", padding: "6px" }}>
              {me?.workspaces.map((ws) => (
                <Item key={ws.id} ws={ws} current={ws.handle === currentHandle} onPick={() => setOpen(false)} />
              ))}
              {meState.status === "loading" && (
                <li className="small muted" style={{ padding: "10px" }} aria-busy="true">
                  Loading workspaces…
                </li>
              )}
              {meState.status === "error" && (
                <li className="err-msg" style={{ padding: "10px" }} role="alert">
                  Your workspaces could not be loaded.
                </li>
              )}
            </ul>
            <div
              style={{
                padding: "10px 16px 12px",
                borderTop: "1px solid var(--og-gray-200)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                fontSize: "13px",
              }}
            >
              <Link
                to="/onboarding/funder"
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Plus className="ic" aria-hidden="true" />
                Create a workspace
              </Link>
              <button
                type="button"
                role="menuitem"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  setOpen(false);
                  await auth.signOut();
                  navigate("/signin");
                }}
              >
                <LogOut className="ic" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
