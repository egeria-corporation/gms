// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Organization details. A workspace linked to Passport reads its details from there and
// edits them there. One that is not linked keeps a profile its admins enter here, always shown to
// funders as not verified, and replaced by the Passport record when the workspace links.
import { Link } from "react-router";
import { BadgeCheck, ExternalLink, ShieldOff } from "lucide-react";
import { useApiMutation, useApiQuery } from "../api/hooks.ts";
import { usePassportFlags } from "../api/launchHooks.ts";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import type { SelfDeclaredProfile } from "../api/types.ts";
import { toPatch } from "../lib/profile.ts";
import { ProfileForm } from "./ProfileForm.tsx";
import { ErrorBanner, Loading, Notice, SaveNote } from "./ui.tsx";

export function OrganizationProfileCard({ workspaceId, connectTo }: { workspaceId: string; connectTo: string }) {
  const ws = useCurrentWorkspace();
  const flags = usePassportFlags();
  const record = useApiQuery((api) => api.workspaceRecord(workspaceId), [workspaceId]);
  const save = useApiMutation((api, profile: SelfDeclaredProfile) => api.updateProfile(workspaceId, toPatch(profile)));
  const canEdit = ws?.member.role === "admin";

  let body;
  if (record.status === "loading") body = <Loading label="Loading your organization details" />;
  else if (record.status === "error") body = <ErrorBanner error={record.error} onRetry={record.reload} title="Your organization details could not be loaded" />;
  else {
    const r = record.data;
    const fromPassport = r.profileSource === "passport";
    if (fromPassport) {
      body = (
        <>
          <p className="row" style={{ gap: "8px" }}>
            <span className="prov prov-passport">
              <BadgeCheck className="ic" aria-hidden="true" />
              From Passport
            </span>
            <span>{r.legalName ?? r.displayName}</span>
          </p>
          <p className="small muted">Your organization’s details come from OpenGrants Passport, so they can’t be changed here. Edit them once in Passport and every funder sees the update.</p>
          <div>
            <a className="btn btn-secondary" href={r.passportOrgId ? `${env.passportWebUrl}/orgs/${r.passportOrgId}` : env.passportWebUrl}>
              <ExternalLink className="ic" aria-hidden="true" />
              Edit in Passport
            </a>
          </div>
        </>
      );
    } else {
      body = (
        <>
          <Notice tone="info" title="Not verified">
            These details are entered by you. Funders see this organization as not verified.
            {flags.linking && " Linking Passport verifies it, fills in forms for you, and replaces what is entered here with the Passport record."}
          </Notice>
          {canEdit ? (
            <ProfileForm
              key={JSON.stringify(r.profile ?? null)}
              idPrefix="settings-profile"
              initial={r.profile ?? { legalName: r.legalName ?? r.displayName }}
              submitLabel="Save details"
              busy={save.state === "saving"}
              error={save.error}
              onSubmit={async (profile) => {
                const result = await save.run(profile);
                if (result && record.status === "ready") record.set({ ...record.data, profile: result.selfDeclared, profileSource: result.source, verification: result.verification });
              }}
              secondary={<SaveNote state={save.state} />}
            />
          ) : (
            <p className="small muted">Only workspace admins can change these details.</p>
          )}
          {flags.linking && (
            <div>
              <Link to={connectTo} className="btn btn-secondary">
                Connect Passport
              </Link>
            </div>
          )}
        </>
      );
    }
  }

  return (
    <section className="card" id="organization-details" aria-labelledby="org-details-h">
      <div className="card-h">
        <div className="row" style={{ gap: "8px" }}>
          {record.status === "ready" && record.data.profileSource !== "passport" && <ShieldOff className="ic" aria-hidden="true" />}
          <h2 id="org-details-h" style={{ fontSize: "18px" }}>
            Organization details
          </h2>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {body}
      </div>
    </section>
  );
}
