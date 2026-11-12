// SPDX-License-Identifier: AGPL-3.0-only
// The self-declared profile form: used when an organization sets up without Passport, and in
// Settings. Legal name and contact email are required; everything else is optional.
import { useState, type FormEvent, type ReactNode } from "react";
import type { SelfDeclaredProfile } from "../api/types.ts";
import { cleanProfile, ORG_TYPES, profileProblems } from "../lib/profile.ts";
import { ErrorBanner, Field, problemFor } from "./ui.tsx";

export function ProfileForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  secondary,
  idPrefix = "profile",
}: {
  initial?: Partial<SelfDeclaredProfile>;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (profile: SelfDeclaredProfile) => void | Promise<void>;
  /** Another action beside the submit button, such as Cancel. */
  secondary?: ReactNode;
  idPrefix?: string;
}) {
  const [v, setV] = useState({
    legalName: initial?.legalName ?? "",
    displayName: initial?.displayName ?? "",
    contactEmail: initial?.contactEmail ?? "",
    website: initial?.website ?? "",
    mission: initial?.mission ?? "",
    orgType: initial?.orgType ?? "",
    ein: initial?.ein ?? "",
    street: initial?.address?.street ?? "",
    city: initial?.address?.city ?? "",
    region: initial?.address?.region ?? "",
    postalCode: initial?.address?.postalCode ?? "",
    country: initial?.address?.country ?? "",
  });
  const [shown, setShown] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const build = (): SelfDeclaredProfile =>
    cleanProfile({
      legalName: v.legalName,
      displayName: v.displayName,
      contactEmail: v.contactEmail,
      website: v.website,
      mission: v.mission,
      orgType: v.orgType,
      ein: v.ein,
      address: { street: v.street, city: v.city, region: v.region, postalCode: v.postalCode, country: v.country },
    });
  const problems = shown ? profileProblems(build()) : [];
  const err = (path: string) => problems.find((p) => p.path === path)?.message ?? problemFor(error, path);
  const id = (k: string) => `${idPrefix}-${k}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    setShown(true);
    if (profileProblems(build()).length) return;
    void onSubmit(build());
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {error !== null && error !== undefined && <ErrorBanner error={error} title="Your details were not saved" />}
      <Field id={id("legal-name")} label="Legal name" required error={err("legalName")}>
        <input className={err("legalName") ? "inp err" : "inp"} id={id("legal-name")} value={v.legalName} onChange={set("legalName")} autoComplete="organization" />
      </Field>
      <Field id={id("contact-email")} label="Contact email" required error={err("contactEmail")} help="Shown to funders you apply to. Letters and award notices go to your workspace admins at the address they sign in with.">
        <input className={err("contactEmail") ? "inp err" : "inp"} id={id("contact-email")} type="email" value={v.contactEmail} onChange={set("contactEmail")} autoComplete="email" />
      </Field>
      <details open={problems.some((p) => p.path !== "legalName" && p.path !== "contactEmail") || undefined}>
        <summary className="small b" style={{ cursor: "pointer" }}>
          More about your organization (optional)
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "12px" }}>
          <div className="fld-row">
            <Field id={id("display-name")} label="Name to show" error={err("displayName")}>
              <input className="inp" id={id("display-name")} value={v.displayName} onChange={set("displayName")} />
            </Field>
            <Field id={id("org-type")} label="Type of organization">
              <select className="sel" id={id("org-type")} value={v.orgType} onChange={set("orgType")}>
                <option value="">Choose one</option>
                {ORG_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="fld-row">
            <Field id={id("website")} label="Website" error={err("website")}>
              <input className={err("website") ? "inp err" : "inp"} id={id("website")} type="url" placeholder="https://" value={v.website} onChange={set("website")} />
            </Field>
            <Field id={id("ein")} label="Organization's EIN (federal tax number)" error={err("ein")} help="The organization's nine-digit employer identification number. Never a Social Security number; leave it empty for an individual. Shown to funders as entered by you, not checked.">
              <input className={err("ein") ? "inp err" : "inp"} id={id("ein")} inputMode="numeric" value={v.ein} onChange={set("ein")} />
            </Field>
          </div>
          <Field id={id("mission")} label="Mission" error={err("mission")}>
            <textarea className="inp" id={id("mission")} rows={3} value={v.mission} onChange={set("mission")} />
          </Field>
          <Field id={id("street")} label="Street address">
            <input className="inp" id={id("street")} value={v.street} onChange={set("street")} autoComplete="street-address" />
          </Field>
          <div className="fld-row">
            <Field id={id("city")} label="City">
              <input className="inp" id={id("city")} value={v.city} onChange={set("city")} />
            </Field>
            <Field id={id("region")} label="State or region">
              <input className="inp" id={id("region")} value={v.region} onChange={set("region")} />
            </Field>
          </div>
          <div className="fld-row">
            <Field id={id("postal")} label="Postal code">
              <input className="inp" id={id("postal")} value={v.postalCode} onChange={set("postalCode")} />
            </Field>
            <Field id={id("country")} label="Country code" error={err("address.country")} help="Two letters, such as US.">
              <input className={err("address.country") ? "inp err" : "inp"} id={id("country")} maxLength={2} value={v.country} onChange={set("country")} />
            </Field>
          </div>
        </div>
      </details>
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {secondary}
      </div>
    </form>
  );
}
