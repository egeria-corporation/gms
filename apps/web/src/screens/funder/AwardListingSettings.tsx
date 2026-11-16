// SPDX-License-Identifier: AGPL-3.0-only
// Settings › Public page › Grants awarded (v1.9.0): "List awards on my public page" (off by
// default), "Show award amounts", and per program whether new awards start confidential. A switch
// flips at once and the save follows; if the save fails it goes back and says why.
import { useState } from "react";
import { Link } from "react-router";
import { Circle, CircleCheck, Info, Lock } from "lucide-react";
import type { AwardListingSettings } from "../../api/awardSharing.ts";
import { useAwardSharingMutation, useAwardSharingQuery } from "../../api/awardSharingHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { ErrorBanner, Loading, SaveNote } from "../../components/ui.tsx";
import { t } from "./i18n.ts";

function Row({ id, label, detail, on, disabled, onToggle }: { id: string; label: string; detail: string; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className={on ? "rc-row rc-pass" : "rc-row rc-unk"}>
      {disabled ? <Lock className="ic" aria-hidden="true" /> : on ? <CircleCheck className="ic" aria-hidden="true" /> : <Circle className="ic" aria-hidden="true" />}
      <div>
        <div className="l" id={id}>
          {label}
        </div>
        <div className="r">
          {on ? t("awardListingSettings.on") : t("awardListingSettings.off")} · {detail}
        </div>
      </div>
      <button type="button" className={on ? "tog on" : "tog"} role="switch" aria-checked={on} aria-labelledby={id} disabled={disabled} onClick={onToggle}></button>
    </div>
  );
}

export function AwardListingCard() {
  const ws = useWorkspace("funder");
  const role = ws.member.role ?? "admin";
  const isAdmin = role === "admin";
  const canDefault = role === "admin" || role === "program_officer";
  const q = useAwardSharingQuery((api) => api.settings(), [ws.id]);
  const save = useAwardSharingMutation((api, patch: { listAwards?: boolean; showAmounts?: boolean }) => api.updateSettings(patch));
  const saveDefault = useAwardSharingMutation((api, programId: string, on: boolean) => api.setProgramDefault(programId, on));
  const [failed, setFailed] = useState(false);
  const s: AwardListingSettings | undefined = q.data;
  const error = save.error ?? saveDefault.error;

  const apply = (out: AwardListingSettings | undefined) => (out ? q.set(out) : setFailed(true));
  const toggle = async (patch: { listAwards?: boolean; showAmounts?: boolean }) => {
    setFailed(false);
    apply(await save.run(patch));
  };
  const toggleDefault = async (programId: string, on: boolean) => {
    setFailed(false);
    apply(await saveDefault.run(programId, on));
  };
  const busy = save.state === "saving" || saveDefault.state === "saving";

  return (
    <section className="card" aria-labelledby="awards-listing-h">
      <div className="card-h">
        <div>
          <h2 id="awards-listing-h">{t("awardListingSettings.grantsAwarded")}</h2>
          <p className="small muted">
            {t.rich("awardListingSettings.listTheGrantsYou", { handle: ws.handle, link: (chunks) => <Link to={`/f/${ws.handle}/awards`} className="mono">{chunks}</Link> })}
          </p>
        </div>
        <SaveNote state={save.state === "saving" || saveDefault.state === "saving" ? "saving" : save.state === "saved" || saveDefault.state === "saved" ? "saved" : "idle"} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {q.status === "loading" && <Loading label={t("awardListingSettings.loadingTheSettings")} />}
        {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
        {failed && error !== null && <ErrorBanner error={error} title={t("awardListingSettings.theSettingDidNot")} />}
        {s && (
          <>
            <div className="rc">
              <Row id="list-awards-label" label={t("awardListingSettings.listAwardsOnMy")} detail="Recipient, program, purpose and year of each award you list. Off until you turn it on." on={s.listAwards} disabled={!isAdmin || busy} onToggle={() => void toggle({ listAwards: !s.listAwards })} />
              <Row id="show-amounts-label" label={t("awardListingSettings.showAwardAmounts")} detail="Amounts on your grants-awarded pages, share cards and the posts grantees are offered." on={s.showAmounts} disabled={!isAdmin || busy} onToggle={() => void toggle({ showAmounts: !s.showAmounts })} />
            </div>
            <p className="small" style={{ margin: 0 }}>
              {t("awardListingSettings.listedConfidentialKeptOff", { listed: s.counts.listed, confidential: s.counts.confidential, recipientUnlisted: s.counts.recipientUnlisted })}
              {s.listAwards && (
                <>
                  {" · "}
                  <Link to={`/f/${ws.handle}/awards`}>{t("awardListingSettings.openYourGrantsAwarded")}</Link>
                </>
              )}
            </p>
            {s.programs.length > 0 && (
              <div>
                <h3 style={{ fontSize: "15px", marginBottom: "8px" }}>{t("awardListingSettings.newAwardsStartConfidential")}</h3>
                <div className="rc">
                  {s.programs.map((p) => (
                    <Row key={p.id} id={`prog-conf-${p.id}`} label={p.name} detail="Awards made from now on in this program start confidential. Awards already made keep their setting." on={p.awardsConfidential} disabled={!canDefault || busy} onToggle={() => void toggleDefault(p.id, !p.awardsConfidential)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {!isAdmin && (
        <div className="card-f small muted">
          <Info className="ic" aria-hidden="true" />
          {t("awardListingSettings.onlyWorkspaceAdminsCan")}{canDefault ? t("awardListingSettings.programOfficersCanSet") : "."}
        </div>
      )}
    </section>
  );
}
