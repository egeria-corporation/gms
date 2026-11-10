// SPDX-License-Identifier: AGPL-3.0-only
// Shared building blocks for live screens. Markup and class names come from the design canvas
// stylesheet (theme/app.css): .crumbs, .ph, .tabs, .tbl, .empty, .rc, .bnr.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, CircleCheck, CircleDashed, CircleX, Info, RefreshCw, TriangleExclamationPoint, type LucideIcon } from "lucide-react";
import type { Checklist, FieldProblem } from "../api/types.ts";
import { ApiError } from "../api/client.ts";

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({ crumbs, title, badge, meta, actions }: { crumbs?: Crumb[]; title: string; badge?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="row" style={{ gap: "6px" }}>
              {i > 0 && <span aria-hidden="true">›</span>}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="ph">
        <div>
          <div className="title">
            <h1>{title}</h1>
            {badge}
          </div>
          {meta && <div className="meta">{meta}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function Tabs<K extends string>({ label, tabs, active, onChange, idPrefix }: { label: string; tabs: TabItem<K>[]; active: K; onChange: (key: K) => void; idPrefix: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.key}`}
          aria-selected={t.key === active}
          aria-controls={`${idPrefix}-panel-${t.key}`}
          tabIndex={t.key === active ? 0 : -1}
          className={t.key === active ? "tab on" : "tab"}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const i = tabs.findIndex((x) => x.key === active);
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
            onChange(next.key);
            document.getElementById(`${idPrefix}-tab-${next.key}`)?.focus();
          }}
        >
          {t.label}
          {t.count !== undefined && <span className="n">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, tab, active, children }: { idPrefix: string; tab: string; active: string; children: ReactNode }) {
  if (tab !== active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${tab}`} aria-labelledby={`${idPrefix}-tab-${tab}`} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <Icon className="ic" aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value to sort by; a column without one is not sortable. */
  sort?: (row: T) => string | number | null;
  numeric?: boolean;
}

export function DataTable<T>({ label, columns, rows, rowKey, empty, selectedKey, compact = false }: { label: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty: ReactNode; selectedKey?: string | null; compact?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sort) return rows;
    const by = col.sort;
    return [...rows].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (!rows.length) return <div className="tbl-wrap">{empty}</div>;
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${label}, scrollable`}>
      <table className={compact ? "tbl tbl-compact" : "tbl"} aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : 0;
              return (
                <th key={c.key} className={c.numeric ? "num" : undefined} aria-sort={c.sort ? (dir === 1 ? "ascending" : dir === -1 ? "descending" : "none") : undefined}>
                  {c.sort ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => setSort(dir === 1 ? { key: c.key, dir: -1 } : dir === -1 ? null : { key: c.key, dir: 1 })}
                    >
                      {c.header}
                      {dir === 1 && <ArrowUp className="ic ic-sm" aria-hidden="true" />}
                      {dir === -1 && <ArrowDown className="ic ic-sm" aria-hidden="true" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className={selectedKey === rowKey(row) ? "sel" : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : undefined}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHECK_ICON = { pass: CircleCheck, fail: CircleX, unknown: CircleDashed } as const;
const CHECK_CLASS = { pass: "rc-pass", fail: "rc-fail", unknown: "rc-unk" } as const;
const CHECK_WORD = { pass: "Passed", fail: "Needs fixing", unknown: "Unknown" } as const;

/**
 * One readiness checklist for every gate (launch a competition, submit an application, release a
 * tranche). Each line is a state icon, a label, the reason and a link to the screen that fixes it.
 * `unknown` is its own state and is never shown as a pass or a fail.
 */
export function ReadinessChecklist({ checklist, title }: { checklist: Checklist; title?: string }) {
  const { pass, fail, unknown } = checklist.summary;
  const total = checklist.items.length;
  const SumIcon = checklist.ready ? CircleCheck : fail > 0 ? CircleX : CircleDashed;
  return (
    <div className="rc">
      <div className={`rc-sum ${checklist.ready ? "rc-pass" : fail > 0 ? "rc-fail" : "rc-unk"}`} role="status">
        <SumIcon className="ic ic-md" aria-hidden="true" />
        <span>
          {title ? `${title}: ` : ""}
          {pass} of {total} checks pass
          {fail > 0 ? ` · ${fail} to fix` : ""}
          {unknown > 0 ? ` · ${unknown} unknown` : ""}
        </span>
      </div>
      <ul>
        {checklist.items.map((item) => {
          const Icon = CHECK_ICON[item.state];
          return (
            <li key={item.key} className={`rc-row ${CHECK_CLASS[item.state]}`}>
              <Icon className="ic" role="img" aria-label={CHECK_WORD[item.state]} />
              <div>
                <div className="l">{item.label}</div>
                {item.reason && <div className="r">{item.reason}</div>}
              </div>
              {item.fixHref ? (
                <Link to={item.fixHref} className="fix">
                  Fix →
                </Link>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Field-level problems from a 422, keyed by the path the API names. */
export function problemsOf(error: unknown): FieldProblem[] {
  if (!(error instanceof ApiError)) return [];
  return error.errors.filter((e): e is FieldProblem => typeof e === "object" && e !== null && typeof (e as FieldProblem).message === "string");
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Something went wrong. Try again.");

export function ErrorBanner({ error, onRetry, title = "That did not work" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const problems = problemsOf(error);
  return (
    <div className="bnr bnr-dng" role="alert">
      <TriangleExclamationPoint className="ic" aria-hidden="true" />
      <div>
        <div className="t">{title}</div>
        <div className="d">{errorMessage(error)}</div>
        {problems.length > 0 && (
          <ul className="d" style={{ listStyle: "disc", paddingLeft: "18px" }}>
            {problems.map((p, i) => (
              <li key={i}>
                {(p.path ?? p.field) ? <span className="mono">{p.path ?? p.field}</span> : null} {p.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-secondary act" onClick={onRetry}>
          <RefreshCw className="ic" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "ok" | "warn" | "neu"; title: string; children?: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "warn" ? TriangleExclamationPoint : Info;
  return (
    <div className={`bnr bnr-${tone}`} role="status">
      <Icon className="ic" aria-hidden="true" />
      <div>
        <div className="t">{title}</div>
        {children && <div className="d">{children}</div>}
      </div>
    </div>
  );
}

/** Inline feedback next to a Save button: "Saving…", "Saved", or nothing. Announced politely. */
export function SaveNote({ state, savedText = "Saved" }: { state: "idle" | "saving" | "saved"; savedText?: string }) {
  return (
    <span className="notice" role="status" aria-live="polite">
      {state === "saving" && "Saving…"}
      {state === "saved" && (
        <>
          <CircleCheck className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
          {savedText}
        </>
      )}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="notice" role="status" aria-busy="true" style={{ padding: "24px 0" }}>
      {label}…
    </div>
  );
}

/** A labelled form field on the design's `.fld` markup. `children` is the control; give it `id`. */
export function Field({ id, label, help, error, required = false, children }: { id: string; label: string; help?: ReactNode; error?: string | null; required?: boolean; children: ReactNode }) {
  return (
    <div className="fld">
      <label className="lbl" htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {help && !error && (
        <span className="help" id={`${id}-help`}>
          {help}
        </span>
      )}
      {error && (
        <span className="err-msg" id={`${id}-err`} role="alert">
          <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

/** The message the API gave for one field, if any. Paths match by suffix (`stages.0.key`, `handle`). */
export function problemFor(error: unknown, path: string): string | null {
  const hit = problemsOf(error).find((p) => (p.path ?? p.field ?? "") === path || (p.path ?? p.field ?? "").endsWith(`.${path}`) || (p.path ?? p.field ?? "").endsWith(`/${path}`));
  return hit?.message ?? null;
}
