// SPDX-License-Identifier: AGPL-3.0-only
// The "In QuickBooks" status of one payment (v1.13.0, Settings › Accounting): whether its expense is in
// the funder's QuickBooks, is being sent, needs attention after a change, or is not there. Shown to
// admins and finance staff only, and only where this server has QuickBooks set up; a payment never
// sent shows nothing. Its words load with it, never by suspending the screen around it.
import { Suspense, useEffect, useState } from "react";
import { CircleCheck, CircleDashed, CircleX, Clock, TriangleAlert } from "lucide-react";
import type { QuickBooksStatus } from "../api/accounting.ts";
import { quickBooksStatuses, useAccountingApi } from "../api/accountingHooks.ts";
import { useAppConfig } from "../api/launchHooks.ts";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { translator, useExtrasMessages } from "../i18n/index.tsx";

const t = translator("extras");

/** A payment's QuickBooks status as an icon and words (never colour alone). */
export function QuickBooksBadge({ status, short = false }: { status: QuickBooksStatus; short?: boolean }) {
  const [cls, Icon, label] =
    status === "posted" || status === "handled"
      ? (["bdg-ok", CircleCheck, t("accounting.badge.posted")] as const)
      : status === "needs_attention"
        ? (["bdg-warn", TriangleAlert, short ? t("accounting.badge.needsAttention") : t("accounting.status.needsAttention")] as const)
        : status === "failed"
          ? (["bdg-warn", CircleX, t("accounting.badge.failed")] as const)
          : status === "posting" || status === "waiting"
            ? (["bdg-info", Clock, t("accounting.badge.sending")] as const)
            : (["bdg-neutral", CircleDashed, t("accounting.status.notSynced")] as const);
  return (
    <span className={`bdg ${cls}`}>
      <Icon className="ic" aria-hidden="true" />
      {label}
    </span>
  );
}

function Status({ trancheId, refresh }: { trancheId: string; refresh: string }) {
  useExtrasMessages();
  const api = useAccountingApi();
  const ws = useCurrentWorkspace();
  const [status, setStatus] = useState<QuickBooksStatus | null>(null);
  useEffect(() => {
    let live = true;
    quickBooksStatuses(api, `${ws?.id ?? ""}:${refresh}`)
      .then((m) => live && setStatus(m.get(trancheId) ?? null))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [api, trancheId, refresh, ws?.id]);
  return status && status !== "not_synced" ? <QuickBooksBadge status={status} short /> : null;
}

/** One-line mount beside a payment's status. `refresh` changes when the payment list was reloaded. */
export function InQuickBooks({ trancheId, refresh = "" }: { trancheId: string; refresh?: string }) {
  const ws = useCurrentWorkspace();
  const available = useAppConfig().available?.quickbooks === true;
  const role = ws?.member.role ?? "admin";
  if (!available || !ws || ws.kind !== "funder" || (role !== "admin" && role !== "finance")) return null;
  return (
    <Suspense fallback={null}>
      <Status trancheId={trancheId} refresh={refresh} />
    </Suspense>
  );
}
