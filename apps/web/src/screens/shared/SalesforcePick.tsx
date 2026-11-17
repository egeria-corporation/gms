// SPDX-License-Identifier: AGPL-3.0-only
// What to read from Salesforce in the import wizard: the Nonprofit Success Pack's grants, the
// Accounts, or a SOQL query of the person's own. Only a SELECT runs; the server refuses anything
// that writes, locks or records a view, and the GMS never writes to Salesforce.
import { useId } from "react";
import { ShieldCheck } from "lucide-react";
import type { ImportSourceInput } from "../../api/imports.ts";
import { Field } from "../../components/ui.tsx";
import { translator, useExtrasMessages } from "../../i18n/index.tsx";

export interface SalesforceChoice {
  what: "npsp_grants" | "accounts" | "query";
  query: string;
}

export const SALESFORCE_START: SalesforceChoice = { what: "npsp_grants", query: "" };

/** The source the wizard reads, or null while the person's own query is still empty. */
export function salesforceSource(c: SalesforceChoice): Extract<ImportSourceInput, { kind: "salesforce" }> | null {
  if (c.what !== "query") return { kind: "salesforce", preset: c.what };
  return c.query.trim() ? { kind: "salesforce", query: c.query.trim() } : null;
}

const tr = translator("extras");

export function SalesforcePick({ value, onChange }: { value: SalesforceChoice; onChange: (next: SalesforceChoice) => void }) {
  useExtrasMessages();
  const id = useId();
  const options: [SalesforceChoice["what"], string, string][] = [
    ["npsp_grants", tr("salesforcePick.grants"), tr("salesforcePick.grantsHelp")],
    ["accounts", tr("salesforcePick.accounts"), tr("salesforcePick.accountsHelp")],
    ["query", tr("salesforcePick.query"), tr("salesforcePick.queryHelp")],
  ];
  return (
    <>
      <p className="row" style={{ gap: "8px", margin: 0 }}>
        <ShieldCheck className="ic" aria-hidden="true" />
        <span className="small">{tr("salesforcePick.readOnly")}</span>
      </p>
      <fieldset className="col" style={{ gap: "8px", border: 0, padding: 0, margin: 0 }}>
        <legend className="b">{tr("salesforcePick.whatToRead")}</legend>
        {options.map(([what, label, help]) => (
          <label key={what} className="row" style={{ gap: "8px", alignItems: "flex-start" }}>
            <input type="radio" name={`${id}-what`} checked={value.what === what} onChange={() => onChange({ ...value, what })} />
            <span>
              <span className="b">{label}</span>
              <span className="small muted" style={{ display: "block" }}>
                {help}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {value.what === "query" && (
        <Field id={`${id}-soql`} label={tr("salesforcePick.soql")} help={tr("salesforcePick.soqlHelp")}>
          <textarea id={`${id}-soql`} className="ta mono" style={{ minHeight: "90px", fontSize: "12px" }} value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} spellCheck={false} />
        </Field>
      )}
    </>
  );
}
