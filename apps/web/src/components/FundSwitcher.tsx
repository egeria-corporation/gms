// SPDX-License-Identifier: AGPL-3.0-only
// The fund switcher in the funder shell: with more than one fund, a person chooses which fund the
// dashboard, programs and awards show ("All funds" by default). A fund advisor sees only their own
// funds here, because the API lists only those. The choice is remembered per workspace in this
// browser; it narrows what is shown, never what the API allows.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Landmark } from "lucide-react";
import { useApiQuery } from "../api/hooks.ts";
import { FUND_COLOR_TOKEN, fundInitials, fundOfProgram, type Fund } from "../api/funds.ts";
import { useWorkspace } from "../app/workspace.tsx";

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
const KEY = (workspaceId: string) => `gms.fund.${workspaceId}`;
const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function read(workspaceId: string): string | null {
  if (memory.has(workspaceId)) return memory.get(workspaceId)!;
  try {
    return window.localStorage.getItem(KEY(workspaceId));
  } catch {
    return null;
  }
}
function write(workspaceId: string, fundId: string | null) {
  memory.set(workspaceId, fundId);
  try {
    if (fundId) window.localStorage.setItem(KEY(workspaceId), fundId);
    else window.localStorage.removeItem(KEY(workspaceId));
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The fund chosen in the switcher for a workspace (null: all funds), and how to change it. */
export function useSelectedFund(workspaceId: string): [string | null, (fundId: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(workspaceId), () => null);
  const set = useCallback((fundId: string | null) => write(workspaceId, fundId), [workspaceId]);
  return [value, set];
}

/** The funds the person sees, the one chosen in the switcher, and filters for what belongs to it. */
export function useFundFilter() {
  const ws = useWorkspace("funder");
  // Async, so an API without funds (an older server, a test double) is an error to hide, not a crash.
  const funds = useApiQuery(async (api) => api.listFunds(), [ws.id]);
  const [selected, select] = useSelectedFund(ws.id);
  return useMemo(() => {
    const list: Fund[] = funds.status === "ready" ? funds.data.items : [];
    const current = list.find((f) => f.id === selected) ?? null;
    const fundOf = (p: { fundId?: string | null }) => fundOfProgram(list, p);
    return {
      status: funds.status,
      funds: list,
      scoped: funds.status === "ready" && funds.data.scoped,
      /** More than one fund to tell apart: show fund names and the filter. */
      several: list.length > 1,
      current,
      select,
      reload: funds.reload,
      fundOf,
      nameOf: (fundId: string | null) => list.find((f) => f.id === fundId)?.name ?? null,
      /** A program shown under the chosen fund (every program when none is chosen). */
      keepProgram: (p: { fundId?: string | null }) => !current || fundOf(p) === current.id,
    };
  }, [funds, selected, select]);
}

/** A fund's colour chip and initials: decoration beside its name, never the only label. */
export function FundMark({ fund, size = 18 }: { fund: Pick<Fund, "name" | "brand">; size?: number }) {
  const color = fund.brand.color ? FUND_COLOR_TOKEN[fund.brand.color] : "var(--og-gray-600)";
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: `${size}px`, height: `${size}px`, borderRadius: "4px", background: color, color: "var(--og-white)", fontSize: `${Math.round(size * 0.5)}px`, fontWeight: 700, flex: "0 0 auto" }}>
      {fundInitials(fund.name)}
    </span>
  );
}

/** In the rail, under the workspace name. Hidden with one fund, unless the person is a fund advisor. */
export function FundSwitcher() {
  const f = useFundFilter();
  if (f.status !== "ready" || (!f.several && !f.scoped) || f.funds.length === 0) return null;
  if (f.funds.length === 1) {
    return (
      <div className="rail-tenant" style={{ borderTop: "none", display: "flex", alignItems: "center", gap: "8px" }} role="group" aria-label={t("fundSwitcher.yourFund")}>
        <FundMark fund={f.funds[0]!} />
        <div>
          <div className="sub">{t("fundSwitcher.yourFund")}</div>
          <div className="small b">{f.funds[0]!.name}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rail-tenant" style={{ borderTop: "none" }}>
      <label className="sub row" htmlFor="fund-switcher" style={{ gap: "6px", marginBottom: "4px" }}>
        <Landmark className="ic ic-sm" aria-hidden="true" />
        {t("fundSwitcher.fund")}
      </label>
      <select id="fund-switcher" className="sel" value={f.current?.id ?? ""} onChange={(e) => f.select(e.target.value || null)}>
        <option value="">{f.scoped ? t("fundSwitcher.allMyFunds") : t("fundSwitcher.allFunds")}</option>
        {f.funds.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </div>
  );
}
