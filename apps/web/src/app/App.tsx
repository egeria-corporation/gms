// SPDX-License-Identifier: AGPL-3.0-only
// Route table. Screens are code-split; `/w/:ws/*` resolves against the workspace kind because
// funder and applicant workspaces share URL shapes (dashboard, applications/:id).
import { mockApplicantStore } from "../api/applicantHooks.ts";
import { mockLaunchStore } from "../api/launchHooks.ts";
import type { AwardDetail } from "../api/funder.ts";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useParams } from "react-router";
import { RequireAuth } from "../auth/RequireAuth.tsx";
import { createServices, ServicesProvider, useServices, type Services } from "./services.tsx";
import { UserbackBridge } from "./UserbackBridge.tsx";
import { useIsPhone } from "./usePhone.ts";
import { useCurrentWorkspace, WorkspaceProvider, type WorkspaceKind } from "./workspace.tsx";
import { NotFound } from "../components/NotFound.tsx";

const Landing = lazy(() => import("../screens/public/Landing.tsx"));
const Agents = lazy(() => import("../screens/public/Agents.tsx"));
const FunderPage = lazy(() => import("../screens/public/FunderPage.tsx"));
const OpportunityPage = lazy(() => import("../screens/public/OpportunityPage.tsx"));
const SignIn = lazy(() => import("../screens/public/SignIn.tsx"));
const PassportReturn = lazy(() => import("../screens/public/PassportReturn.tsx"));
const InvitationAccept = lazy(() => import("../screens/public/InvitationAccept.tsx"));
const ClaimAward = lazy(() => import("../screens/public/ClaimAward.tsx"));
const WorkspaceSwitcher = lazy(() => import("../screens/public/WorkspaceSwitcher.tsx"));
const FunderOnboarding = lazy(() => import("../screens/public/FunderOnboarding.tsx"));
const ApplicantOnboarding = lazy(() => import("../screens/public/ApplicantOnboarding.tsx"));
const ApplyEntry = lazy(() => import("../screens/public/ApplyEntry.tsx"));
const Notifications = lazy(() => import("../screens/public/Notifications.tsx"));
const AccountSettings = lazy(() => import("../screens/public/AccountSettings.tsx"));
const FDashboard = lazy(() => import("../screens/funder/Dashboard.tsx"));
const FPrograms = lazy(() => import("../screens/funder/Programs.tsx"));
const FOpportunityBuilder = lazy(() => import("../screens/funder/OpportunityBuilder.tsx"));
const FFormBuilder = lazy(() => import("../screens/funder/FormBuilder.tsx"));
const FCompetition = lazy(() => import("../screens/funder/Competition.tsx"));
const FOpportunities = lazy(() => import("../screens/funder/Opportunities.tsx"));
const FForms = lazy(() => import("../screens/funder/Forms.tsx"));
const FSettingsPassport = lazy(() => import("../screens/funder/SettingsPassport.tsx"));
const FApplications = lazy(() => import("../screens/funder/Applications.tsx"));
const FApplicationsEmpty = lazy(() => import("../screens/funder/ApplicationsEmpty.tsx"));
const FApplicationDetail = lazy(() => import("../screens/funder/ApplicationDetail.tsx"));
const FReviewAssignment = lazy(() => import("../screens/funder/ReviewAssignment.tsx"));
const FReviewerAssignments = lazy(() => import("../screens/funder/ReviewerAssignments.tsx"));
const FReviewerScoring = lazy(() => import("../screens/funder/ReviewerScoring.tsx"));
const FPanel = lazy(() => import("../screens/funder/Panel.tsx"));
const FAwardAgreement = lazy(() => import("../screens/funder/AwardAgreement.tsx"));
const FNewAward = lazy(() => import("../screens/funder/NewAward.tsx"));
const FAwardPayments = lazy(() => import("../screens/funder/AwardPayments.tsx"));
const FPaymentsDue = lazy(() => import("../screens/funder/PaymentsDue.tsx"));
const FPaymentsInFlight = lazy(() => import("../screens/funder/PaymentsInFlight.tsx"));
const FPaymentsReconcile = lazy(() => import("../screens/funder/PaymentsReconcile.tsx"));
const FPaymentsLedger = lazy(() => import("../screens/funder/PaymentsLedger.tsx"));
const FReporting = lazy(() => import("../screens/funder/Reporting.tsx"));
const FGrantees = lazy(() => import("../screens/funder/Grantees.tsx"));
const FAnalytics = lazy(() => import("../screens/funder/Analytics.tsx"));
const FCommunications = lazy(() => import("../screens/funder/Communications.tsx"));
const ConnectorReturn = lazy(() => import("../screens/funder/GoogleWorkspace.tsx").then((m) => ({ default: m.ConnectorReturn })));
const FSettingsMcp = lazy(() => import("../screens/funder/SettingsMcp.tsx"));
const FApprovals = lazy(() => import("../screens/funder/Approvals.tsx"));
const ADashboard = lazy(() => import("../screens/applicant/Dashboard.tsx"));
const AOrganization = lazy(() => import("../screens/applicant/Organization.tsx"));
const AFindFunding = lazy(() => import("../screens/applicant/FindFunding.tsx"));
const AEditor = lazy(() => import("../screens/applicant/Editor.tsx"));
const AEditorSubmit = lazy(() => import("../screens/applicant/EditorSubmit.tsx"));
const AConfirmation = lazy(() => import("../screens/applicant/Confirmation.tsx"));
const AApplicationStatus = lazy(() => import("../screens/applicant/ApplicationStatus.tsx"));
const AApplications = lazy(() => import("../screens/applicant/Applications.tsx"));
const AGrantOffered = lazy(() => import("../screens/applicant/GrantOffered.tsx"));
const AGrantPayments = lazy(() => import("../screens/applicant/GrantPayments.tsx"));
const AReports = lazy(() => import("../screens/applicant/Reports.tsx"));
const AAnswerLibrary = lazy(() => import("../screens/applicant/AnswerLibrary.tsx"));
const ATeamAccess = lazy(() => import("../screens/applicant/TeamAccess.tsx"));
const AFunders = lazy(() => import("../screens/applicant/Funders.tsx"));
const AFunderRecord = lazy(() => import("../screens/applicant/FunderRecord.tsx"));
const AOutsideApplication = lazy(() => import("../screens/applicant/OutsideApplication.tsx"));
const ASettings = lazy(() => import("../screens/applicant/Settings.tsx"));
const ADashboardPhone = lazy(() => import("../screens/applicant/phone/DashboardPhone.tsx"));
const AOrganizationPhone = lazy(() => import("../screens/applicant/phone/OrganizationPhone.tsx"));
const AEditorPhone = lazy(() => import("../screens/applicant/phone/EditorPhone.tsx"));
const AApplicationStatusPhone = lazy(() => import("../screens/applicant/phone/ApplicationStatusPhone.tsx"));
const AGrantPhone = lazy(() => import("../screens/applicant/phone/GrantPhone.tsx"));
const AReportsPhone = lazy(() => import("../screens/applicant/phone/ReportsPhone.tsx"));
const SgFormRenderer = lazy(() => import("../screens/styleguide/FormRenderer.tsx"));
const SgStatusVocabulary = lazy(() => import("../screens/styleguide/StatusVocabulary.tsx"));
const SgComponentsA = lazy(() => import("../screens/styleguide/ComponentsA.tsx"));
const SgComponentsB = lazy(() => import("../screens/styleguide/ComponentsB.tsx"));
const SgApprovalFlow = lazy(() => import("../screens/styleguide/ApprovalFlow.tsx"));
const SgPassportConsentReference = lazy(() => import("../screens/styleguide/PassportConsentReference.tsx"));
const OAuthConsent = lazy(() => import("../screens/shared/OAuthConsent.tsx"));
const EmailAck = lazy(() => import("../screens/shared/email/EmailAck.tsx"));
const EmailRevision = lazy(() => import("../screens/shared/email/EmailRevision.tsx"));
const EmailDecline = lazy(() => import("../screens/shared/email/EmailDecline.tsx"));
const EmailAward = lazy(() => import("../screens/shared/email/EmailAward.tsx"));
const EmailReminder = lazy(() => import("../screens/shared/email/EmailReminder.tsx"));
const EmailPaymentSent = lazy(() => import("../screens/shared/email/EmailPaymentSent.tsx"));
const PdfSnapshot = lazy(() => import("../screens/shared/pdf/PdfSnapshot.tsx"));
const PdfAgreement = lazy(() => import("../screens/shared/pdf/PdfAgreement.tsx"));
const PdfCloseout = lazy(() => import("../screens/shared/pdf/PdfCloseout.tsx"));

/** Renders the funder or the applicant screen for a URL both workspace kinds share. */
function ByKind({ funder, applicant }: { funder: ReactNode; applicant: ReactNode }) {
  const ws = useCurrentWorkspace();
  if (!ws) return <NotFound />;
  return ws.kind === "funder" ? funder : applicant;
}

/** Guards a route that exists for one workspace kind only. */
function Only({ kind, children }: { kind: WorkspaceKind; children: ReactNode }) {
  const ws = useCurrentWorkspace();
  return ws?.kind === kind ? children : <NotFound />;
}

/** Applicant screens with a dedicated phone layout in the design. */
function Responsive({ desktop, phone }: { desktop: ReactNode; phone: ReactNode }) {
  return useIsPhone() ? phone : desktop;
}

function WorkspaceLayout() {
  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  );
}

const EMAIL_PREVIEWS: Record<string, ReactNode> = {
  acknowledgment: <EmailAck />,
  "revision-request": <EmailRevision />,
  decline: <EmailDecline />,
  award: <EmailAward />,
  "report-reminder": <EmailReminder />,
  "payment-sent": <EmailPaymentSent />,
};

const PDF_PREVIEWS: Record<string, ReactNode> = {
  "application-snapshot": <PdfSnapshot />,
  agreement: <PdfAgreement />,
  closeout: <PdfCloseout />,
};

function Preview({ of }: { of: Record<string, ReactNode> }) {
  const { kind = "" } = useParams();
  const doc = of[kind];
  return doc ? <div className="preview-frame">{doc}</div> : <NotFound />;
}

const f = (el: ReactNode) => <Only kind="funder">{el}</Only>;
const a = (el: ReactNode) => <Only kind="applicant">{el}</Only>;

export function App({ services }: { services?: Services }) {
  // Built once per mount; tests pass their own.
  const [resolved] = useState(() => services ?? createServices());
  // Mock mode only: lets a demo or an end-to-end test deliver what only Passport sends in
  // production (a settlement, a destination change taking effect, an outage).
  useEffect(() => {
    if (resolved.mock) {
      (window as unknown as { __gmsMock?: unknown }).__gmsMock = resolved.api;
      // The mock's install switches (payments through Passport), so a flow can run with them on.
      (window as unknown as { __gmsLaunch?: unknown }).__gmsLaunch = mockLaunchStore(resolved);
      // A direct award that an organization accepts reaches that organization's own grants.
      (resolved.api as { onPublished?: (cb: (award: AwardDetail) => void) => void }).onPublished?.((award) => {
        mockApplicantStore(resolved).awards.unshift(award);
      });
    }
  }, [resolved]);
  return (
    <ServicesProvider services={resolved}>
      <AppRoutes />
    </ServicesProvider>
  );
}

function AppRoutes() {
  // The design reference boards and template previews carry demo content: demo (mock) mode only.
  const { mock } = useServices();
  return (
    <Suspense fallback={<div className="gms gms-frame" aria-busy="true" />}>
      <UserbackBridge />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/f/:handle" element={<FunderPage />} />
        <Route path="/f/:handle/o/:slug" element={<OpportunityPage />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/auth/passport" element={<PassportReturn />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/workspaces" element={<WorkspaceSwitcher />} />
        {/* The agent consent page. Not under /oauth/: the site hands every /oauth/ path to the API. */}
        <Route path="/consent" element={<OAuthConsent />} />
        {/* An award invitation. Outside the guard so the token is lifted out of the address before any sign-in `next` is built. */}
        <Route path="/awards/claim" element={<ClaimAward />} />

        {/* Everything below needs a signed-in person. */}
        <Route element={<RequireAuth />}>
          <Route path="/onboarding/funder" element={<Navigate to="/onboarding/funder/organization" replace />} />
          <Route path="/onboarding/funder/:step" element={<FunderOnboarding />} />
          <Route path="/onboarding/applicant" element={<ApplicantOnboarding />} />
          <Route path="/apply/:handle/:slug" element={<ApplyEntry />} />
          <Route path="/invitations/accept" element={<InvitationAccept />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/account" element={<Navigate to="/account/agents" replace />} />
          <Route path="/account/agents" element={<AccountSettings />} />

          {/* Reviewer portal: external reviewers have no workspace rail. */}
          <Route path="/review/assignments" element={<FReviewerAssignments />} />
          <Route path="/review/score/:appId" element={<FReviewerScoring />} />

          <Route path="/w/:ws" element={<WorkspaceLayout />}>
            <Route
              index
              element={<ByKind funder={<FDashboard />} applicant={<Responsive desktop={<ADashboard />} phone={<ADashboardPhone />} />} />}
            />
            <Route
              path="applications/:appId"
              element={
                <ByKind
                  funder={<FApplicationDetail />}
                  applicant={<Responsive desktop={<AApplicationStatus />} phone={<AApplicationStatusPhone />} />}
                />
              }
            />

            {/* Funder workspace */}
            <Route path="programs" element={f(<FPrograms />)} />
            <Route path="programs/:programId" element={f(<FPrograms />)} />
            <Route path="opportunities" element={f(<FOpportunities />)} />
            <Route path="opportunities/new" element={f(<FOpportunityBuilder />)} />
            <Route path="opportunities/:oppId/edit" element={f(<FOpportunityBuilder />)} />
            <Route path="opportunities/:oppId/competition" element={f(<FCompetition />)} />
            <Route path="forms" element={f(<FForms />)} />
            <Route path="forms/:formId/edit" element={f(<FFormBuilder />)} />
            <Route path="competitions/:compId" element={f(<FCompetition />)} />
            <Route path="competitions/:compId/panel" element={f(<FPanel />)} />
            <Route path="applications" element={<ByKind funder={<FApplications />} applicant={<AApplications />} />} />
            <Route path="applications/first-run" element={f(<FApplicationsEmpty />)} />
            <Route path="reviews/assign" element={f(<FReviewAssignment />)} />
            <Route path="awards" element={f(<FAwardAgreement />)} />
            <Route path="awards/new" element={f(<FNewAward />)} />
            <Route path="awards/:awardId" element={<Navigate to="agreement" replace />} />
            <Route path="awards/:awardId/agreement" element={f(<FAwardAgreement />)} />
            <Route path="awards/:awardId/payments" element={f(<FAwardPayments />)} />
            <Route path="payments" element={<Navigate to="due" replace />} />
            <Route path="payments/due" element={f(<FPaymentsDue />)} />
            <Route path="payments/in-flight" element={f(<FPaymentsInFlight />)} />
            <Route path="payments/reconcile" element={f(<FPaymentsReconcile />)} />
            <Route path="payments/ledger" element={f(<FPaymentsLedger />)} />
            <Route path="reporting" element={f(<FReporting />)} />
            <Route path="grantees" element={f(<FGrantees />)} />
            <Route path="grantees/:granteeId" element={f(<FGrantees />)} />
            <Route path="analytics" element={f(<FAnalytics />)} />
            <Route path="communications" element={f(<FCommunications />)} />
            <Route path="settings" element={<ByKind funder={<Navigate to="passport" replace />} applicant={<ASettings />} />} />
            <Route path="settings/passport" element={f(<FSettingsPassport />)} />
            <Route path="settings/mcp" element={f(<FSettingsMcp />)} />
            {/* Where the API sends a person back to after a provider's sign-in (Google Workspace). */}
            <Route path="settings/connectors" element={<ConnectorReturn />} />
            <Route path="approvals" element={f(<FApprovals />)} />

            {/* Applicant workspace */}
            <Route path="organization" element={a(<Responsive desktop={<AOrganization />} phone={<AOrganizationPhone />} />)} />
            <Route path="find" element={a(<AFindFunding />)} />
            <Route path="applications/:appId/edit" element={a(<Responsive desktop={<AEditor />} phone={<AEditorPhone />} />)} />
            <Route path="applications/:appId/edit/submit" element={a(<AEditorSubmit />)} />
            <Route path="applications/:appId/submitted" element={a(<AConfirmation />)} />
            <Route path="grants/:awardId" element={a(<Responsive desktop={<AGrantPayments />} phone={<AGrantPhone />} />)} />
            <Route path="grants" element={a(<AGrantOffered />)} />
            <Route path="grants/:awardId/offer" element={a(<AGrantOffered />)} />
            <Route path="reports" element={a(<Responsive desktop={<AReports />} phone={<AReportsPhone />} />)} />
            <Route path="library" element={a(<AAnswerLibrary />)} />
            <Route path="team" element={a(<ATeamAccess />)} />
            <Route path="funders" element={a(<AFunders />)} />
            {/* Applications to funders outside this GMS, and the applicant's own record of each funder. */}
            <Route path="funders/:recordId" element={a(<AFunderRecord />)} />
            <Route path="outside/:outsideId" element={a(<AOutsideApplication />)} />
          </Route>
        </Route>

        {/* Component reference from the design canvas, and the email / PDF templates */}
        {mock && (
          <>
            <Route path="/styleguide/form" element={<SgFormRenderer />} />
            <Route path="/styleguide/status" element={<SgStatusVocabulary />} />
            <Route path="/styleguide/components-a" element={<SgComponentsA />} />
            <Route path="/styleguide/components-b" element={<SgComponentsB />} />
            <Route path="/styleguide/approval-flow" element={<SgApprovalFlow />} />
            <Route path="/styleguide/passport-consent" element={<SgPassportConsentReference />} />
            <Route path="/preview/email/:kind" element={<Preview of={EMAIL_PREVIEWS} />} />
            <Route path="/preview/pdf/:kind" element={<Preview of={PDF_PREVIEWS} />} />
          </>
        )}

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
