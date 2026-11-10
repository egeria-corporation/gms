// SPDX-License-Identifier: AGPL-3.0-only
// "Apply with Passport" lands here once the person is signed in. Someone who already has an
// applicant workspace goes to Find funding there, where the opportunity shows its eligibility
// result and Start application; anyone else connects their organization from Passport first.
import { Navigate, useParams } from "react-router";
import { Busy } from "../../auth/RequireAuth.tsx";
import { useServices } from "../../app/services.tsx";
import { ErrorBanner } from "../../components/ui.tsx";

export default function ApplyEntry() {
  const { handle = "", slug = "" } = useParams();
  const { meState, reloadMe } = useServices();
  if (meState.status === "loading") return <Busy />;
  if (meState.status === "error") {
    return (
      <main className="gms gms-frame" style={{ padding: "32px" }}>
        <title>Apply — OpenGrants GMS</title>
        <ErrorBanner error={meState.error} onRetry={reloadMe} title="We could not load your workspaces" />
      </main>
    );
  }
  const applicant = meState.me.workspaces.find((w) => w.kind === "applicant");
  const want = `funder=${encodeURIComponent(handle)}&opportunity=${encodeURIComponent(slug)}`;
  return <Navigate to={applicant ? `/w/${applicant.handle}/find?${want}` : `/onboarding/applicant?${want}`} replace />;
}
