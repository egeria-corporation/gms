// SPDX-License-Identifier: AGPL-3.0-only
// Small pieces shared by the launch-preparation screens.
import { Fragment } from "react";
import { Info } from "lucide-react";
import type { FunderContact } from "../api/launch.ts";
import { useLaunchQuery } from "../api/launchHooks.ts";

import { intlLocale, translator } from "../i18n/index.tsx";

const t = translator("shared");
/** Shown wherever a payment could be released, while payments through Passport are switched off. */
export function PaymentsOffNotice() {
  return (
    <div className="bnr bnr-info" role="note">
      <Info className="ic" aria-hidden="true" />
      <div>
        <div className="t">{t("launch.paymentsThroughPassportAreNot")}</div>
        <div className="d">{t("launch.payGranteesTheWayYou")}</div>
      </div>
    </div>
  );
}

/** The label for recording a payment made elsewhere; the primary action while payments through Passport are off. */
export const recordOutsideLabel = (): string => t("launch.recordOutsideLabel");
/** @deprecated The English label; use `recordOutsideLabel()`, which follows the page's language. */
export const RECORD_OUTSIDE_LABEL = "Record a payment made outside the GMS";

/** One contact's name, address and telephone, as the funder listed them. */
export function ContactLine({ contact }: { contact: FunderContact }) {
  return (
    <>
      <span className="b">{contact.name}</span>
      {" · "}
      <a href={`mailto:${contact.email}`}>{contact.email}</a>
      {contact.phone && (
        <>
          {" · "}
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>
        </>
      )}
    </>
  );
}

/**
 * The people a funder lists for applicants, as rows of a `dl.kv`: the role, then the person. Falls
 * back to the one published address, and says so plainly when the funder lists nobody.
 */
export function FunderContactRows({ handle, fallbackEmail }: { handle: string; fallbackEmail: string | null }) {
  const q = useLaunchQuery((api) => api.funderContacts(handle), [handle]);
  const contacts = q.data ?? [];
  if (contacts.length === 0) {
    return (
      <>
        <dt>{t("launch.email")}</dt>
        <dd>{fallbackEmail ? <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a> : <span className="muted">{t("launch.notPublishedUseTheShared")}</span>}</dd>
      </>
    );
  }
  return (
    <>
      {contacts.map((c) => (
        <Fragment key={`${c.name}|${c.email}`}>
          <dt>{c.title ?? t("launch.contact")}</dt>
          <dd>
            <ContactLine contact={c} />
          </dd>
        </Fragment>
      ))}
    </>
  );
}

/** Whether a workspace's monthly assistant drafts are used up. An unknown limit never counts as spent. */
export function quotaSpent(quota: { used?: number; limit?: number; remaining?: number } | null | undefined): boolean {
  if (!quota) return false;
  if (quota.remaining !== undefined) return quota.remaining <= 0;
  return quota.limit !== undefined && (quota.used ?? 0) >= quota.limit;
}

/** Said in place of a draft once the month's assistant drafts are used up. */
export function QuotaSpentNote({ resetsAt }: { resetsAt?: string | null | undefined }) {
  return (
    <p className="help" role="status">
      {t("launch.thisMonthSDraftsAre")} {resetsAt ? t("launch.theCountResetsOn", { date: new Date(resetsAt).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", timeZone: "UTC" }) }) : t("launch.theCountResetsAtThe")}
    </p>
  );
}
