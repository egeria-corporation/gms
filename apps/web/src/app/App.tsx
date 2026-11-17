// SPDX-License-Identifier: AGPL-3.0-only
// Route table. Screens are code-split; `/w/:ws/*` resolves against the workspace kind because
// funder and applicant workspaces share URL shapes (dashboard, applications/:id).
import { mockApplicantStore } from "../api/applicantHooks.ts";
import { mockLaunchStore } from "../api/launchHooks.ts";
import type { AwardDetail } from "../api/funder.ts";
import { lazy, Suspense, useEffect, useLayoutEffect, useState, type ComponentType, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { RequireAuth } from "../auth/RequireAuth.tsx";
import { createServices, ServicesProvider, useServices, type Services } from "./services.tsx";
import { UserbackBridge } from "./UserbackBridge.tsx";
import { useIsPhone } from "./usePhone.ts";
import { useCurrentWorkspace, WorkspaceProvider, type WorkspaceKind } from "./workspace.tsx";
import { NotFound } from "../components/NotFound.tsx";
import { pageChanged, watchActions } from "../lib/announce.ts";
import { usePublicMessages, useLocale, useT } from "../i18n/index.tsx";
import { LocaleFromPreference } from "../components/LanguageSwitcher.tsx";

/**
 * A public screen, with its messages: the `public` catalog is a chunk of its own, loaded with the
 * public screens only. The screen's code and the catalog are fetched side by side, and the screen
 * renders once both are here (in the current language, after a language change too).
 */
function publicScreen(load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Screen = lazy(load);
  return function PublicScreen() {
    void load().catch(() => undefined);
    usePublicMessages();
    return <Screen />;
  };
}

const Landing = publicScreen(() => import("../screens/public/Landing.tsx"));
const Agents = publicScreen(() => import("../screens/public/Agents.tsx"));
// The switch pages and their free migration request.
const Switch = publicScreen(() => import("../screens/public/Switch.tsx"));
const SwitchSystem = publicScreen(() => import("../screens/public/SwitchSystem.tsx"));
const FunderPage = publicScreen(() => import("../screens/public/FunderPage.tsx"));
const OpportunityPage = publicScreen(() => import("../screens/public/OpportunityPage.tsx"));
// Award sharing (v1.9.0): the grants a funder has awarded, and one award's page.
const FunderAwards = publicScreen(() => import("../screens/public/FunderAwards.tsx"));
const AwardPublic = publicScreen(() => import("../screens/public/AwardPublic.tsx"));
const EmbedWidget = publicScreen(() => import("../screens/public/EmbedWidget.tsx"));
const SignIn = publicScreen(() => import("../screens/public/SignIn.tsx"));
const PassportReturn = publicScreen(() => import("../screens/public/PassportReturn.tsx"));
const InvitationAccept = publicScreen(() => import("../screens/public/InvitationAccept.tsx"));
const JoinDraft = lazy(() => import("../screens/applicant/JoinDraft.tsx"));
const ClaimAward = publicScreen(() => import("../screens/public/ClaimAward.tsx"));
// Opt-in digests (v1.9.0): the one-click unsubscribe page, no sign-in.
const DigestUnsubscribe = publicScreen(() => import("../screens/public/DigestUnsubscribe.tsx"));
const WorkspaceSwitcher = publicScreen(() => import("../screens/public/WorkspaceSwitcher.tsx"));
const FunderOnboarding = publicScreen(() => import("../screens/public/FunderOnboarding.tsx"));
const ApplicantOnboarding = publicScreen(() => import("../screens/public/ApplicantOnboarding.tsx"));
const ApplyEntry = publicScreen(() => import("../screens/public/ApplyEntry.tsx"));
const Notifications = publicScreen(() => import("../screens/public/Notifications.tsx"));
const AccountSettings = publicScreen(() => import("../screens/public/AccountSettings.tsx"));
// The template gallery: public pages, and the moderators' queue.
const Gallery = publicScreen(() => import("../screens/public/Gallery.tsx"));
const GalleryItem = publicScreen(() => import("../screens/public/GalleryItem.tsx"));
const GalleryModeration = publicScreen(() => import("../screens/public/GalleryModeration.tsx"));
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
const FReportBuilder = lazy(() => import("../screens/funder/ReportBuilder.tsx"));
const FCommunications = lazy(() => import("../screens/funder/Communications.tsx"));
const ConnectorReturn = lazy(() => import("../screens/funder/GoogleWorkspace.tsx").then((m) => ({ default: m.ConnectorReturn })));
// Connected apps (v1.12.0): Slack alerts, Google Calendar, Google Drive, Salesforce.
const ConnectedApps = lazy(() => import("../screens/shared/ConnectedApps.tsx"));
// F3: the operators' growth measures (its words are in the extras catalog).
const OperatorMeasures = lazy(() => import("../screens/operator/Measures.tsx"));
const FSettingsMcp = lazy(() => import("../screens/funder/SettingsMcp.tsx"));
const FSettingsPublicPage = lazy(() => import("../screens/funder/SettingsPublicPage.tsx"));
const FSettingsSecurity = lazy(() => import("../screens/funder/SettingsSecurity.tsx"));
const SettingsSocial = lazy(() => import("../screens/shared/SettingsSocial.tsx"));
const FFundSettings = lazy(() => import("../screens/funder/FundSettings.tsx"));
const FundPage = publicScreen(() => import("../screens/public/FundPage.tsx"));
const FApprovals = lazy(() => import("../screens/funder/Approvals.tsx"));
// E4: funder loops (for funders, partners, co-branded onboarding, invite a funder, partner settings).
const ForFunders = publicScreen(() => import("../screens/public/ForFunders.tsx"));
const Partners = publicScreen(() => import("../screens/public/Partners.tsx"));
const PartnersModeration = publicScreen(() => import("../screens/public/PartnersModeration.tsx"));
const Join = publicScreen(() => import("../screens/public/Join.tsx"));
const FInviteFunder = lazy(() => import("../screens/funder/InviteFunder.tsx"));
const FPartnerSettings = lazy(() => import("../screens/funder/PartnerSettings.tsx"));
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
const ADocuments = lazy(() => import("../screens/applicant/Documents.tsx"));
const AOutsideAward = lazy(() => import("../screens/applicant/OutsideAward.tsx"));
const AFundingSummary = lazy(() => import("../screens/applicant/FundingSummary.tsx"));
// C4: the guest reviewer's welcome and done screens.
const FGuestReviewerWelcome = lazy(() => import("../screens/funder/GuestReviewerWelcome.tsx"));
const FGuestReviewerDone = lazy(() => import("../screens/funder/GuestReviewerDone.tsx"));
const ImportWizard = lazy(() => import("../screens/shared/ImportWizard.tsx"));
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
  return doc ? <main className="preview-frame">{doc}</main> : <NotFound />;
}

const f = (el: ReactNode) => <Only kind="funder">{el}</Only>;
const a = (el: ReactNode) => <Only kind="applicant">{el}</Only>;

export function App({ services }: { services?: Services }) {
  // Built once per mount; tests pass their own.
  const [resolved] = useState(() => services ?? createServices());
  // The page's one polite live region, and when the person last acted (lib/announce.ts).
  useEffect(() => watchActions(), []);
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
      <LocaleFromPreference />
      <LocalizedRoutes />
    </ServicesProvider>
  );
}

/**
 * The screens, rebuilt when the language changes: every label, date and amount is drawn again in
 * the new language, including values a screen computed once. The session and the address are kept.
 */
function LocalizedRoutes() {
  const locale = useLocale();
  return <AppRoutes key={locale} />;
}

/**
 * The first stop for the keyboard on every page: moves focus to the page's main content, past the
 * top bar and the rail (WCAG 2.4.1). Screens render their own <main>, so the link finds it on use.
 */
function SkipLink() {
  const t = useT("shared");
  return (
    <a
      href="#main"
      className="skip-link"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>("main, [role=main]");
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
      }}
    >
      {t("app.skipLink")}
    </a>
  );
}

function AppRoutes() {
  // The design reference boards and template previews carry demo content: demo (mock) mode only.
  const { mock } = useServices();
  // The apply widget runs inside other sites' pages: no feedback widget there, and a plain frame.
  const location = useLocation();
  const embedded = location.pathname.startsWith("/embed/");
  // A layout effect runs before any screen's banner effects: banners on a new screen are not announced.
  useLayoutEffect(() => pageChanged(), [location.pathname, location.search]);
  return (
    <Suspense fallback={<div className={embedded ? "gms embed" : "gms gms-frame"} aria-busy="true" />}>
      {!embedded && <UserbackBridge />}
      {!embedded && <SkipLink />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/f/:handle" element={<FunderPage />} />
        <Route path="/f/:handle/o/:slug" element={<OpportunityPage />} />
        <Route path="/f/:handle/awards" element={<FunderAwards />} />
        <Route path="/f/:handle/awards/:slug" element={<AwardPublic />} />
        <Route path="/f/:handle/:fundSlug" element={<FundPage />} />
        {/* The embeddable apply widget. Any site may frame /embed/* (build/headers.ts); no sign-in. */}
        <Route path="/embed/f/:handle/o/:slug" element={<EmbedWidget />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/auth/passport" element={<PassportReturn />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/switch" element={<Switch />} />
        <Route path="/switch/:system" element={<SwitchSystem />} />
        <Route path="/workspaces" element={<WorkspaceSwitcher />} />
        {/* The agent consent page. Not under /oauth/: the site hands every /oauth/ path to the API. */}
        <Route path="/consent" element={<OAuthConsent />} />
        {/* An award invitation. Outside the guard so the token is lifted out of the address before any sign-in `next` is built. */}
        <Route path="/awards/claim" element={<ClaimAward />} />
        {/* The template gallery: anyone browses and previews; copying asks for a sign-in. */}
        <Route path="/templates" element={<Gallery />} />
        <Route path="/templates/:slug" element={<GalleryItem />} />
        {/* An email's "Stop getting this email" link: the signed token is the proof, so no sign-in. */}
        <Route path="/digests/unsubscribe" element={<DigestUnsubscribe />} />
        {/* E4: funder loops. */}
        <Route path="/for-funders" element={<ForFunders />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/join/:token" element={<Join />} />

        {/* Everything below needs a signed-in person. */}
        <Route element={<RequireAuth />}>
          <Route path="/onboarding/funder" element={<Navigate to="/onboarding/funder/organization" replace />} />
          <Route path="/onboarding/funder/:step" element={<FunderOnboarding />} />
          <Route path="/onboarding/applicant" element={<ApplicantOnboarding />} />
          <Route path="/apply/:handle/:slug" element={<ApplyEntry />} />
          <Route path="/invitations/accept" element={<InvitationAccept />} />
          {/* An invitation into one draft (v1.7.0): lands on the question or section to write. */}
          <Route path="/invitations/draft" element={<JoinDraft />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/account" element={<Navigate to="/account/agents" replace />} />
          <Route path="/account/agents" element={<AccountSettings />} />
          <Route path="/gallery/moderation" element={<GalleryModeration />} />
          <Route path="/partners/moderation" element={<PartnersModeration />} />
          {/* F3: operators only (OPERATORS); everyone else is told so. */}
          <Route path="/operator/measures" element={<OperatorMeasures />} />

          {/* Reviewer portal: external reviewers have no workspace rail. */}
          <Route path="/review/assignments" element={<FReviewerAssignments />} />
          <Route path="/review/score/:appId" element={<FReviewerScoring />} />
          {/* C4: a guest reviewer lands here from the invitation, and ends here after the last review. */}
          <Route path="/review/welcome" element={<FGuestReviewerWelcome />} />
          <Route path="/review/done" element={<FGuestReviewerDone />} />

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
            <Route path="report-builder" element={f(<FReportBuilder />)} />
            <Route path="communications" element={f(<FCommunications />)} />
            <Route path="settings" element={<ByKind funder={<Navigate to="passport" replace />} applicant={<ASettings />} />} />
            <Route path="settings/passport" element={f(<FSettingsPassport />)} />
            <Route path="settings/mcp" element={f(<FSettingsMcp />)} />
            <Route path="settings/public-page" element={f(<FSettingsPublicPage />)} />
            <Route path="settings/security" element={f(<FSettingsSecurity />)} />
            {/* Social accounts (Zernio), both kinds of workspace; Zernio returns here after a connection. */}
            <Route path="settings/social" element={<SettingsSocial />} />
            <Route path="settings/funds" element={f(<FFundSettings />)} />
            <Route path="settings/invite-funders" element={f(<FInviteFunder />)} />
            <Route path="settings/partners" element={f(<FPartnerSettings />)} />
            {/* Where the API sends a person back to after a provider's sign-in (Google Workspace). */}
            <Route path="settings/connectors" element={<ConnectorReturn />} />
            {/* Connected apps, both kinds of workspace; Composio returns here after a sign-in. */}
            <Route path="settings/apps" element={<ConnectedApps />} />
            {/* Import from a spreadsheet: grant history in a funder workspace, applications in an applicant one. */}
            <Route path="import" element={<ImportWizard />} />
            <Route path="approvals" element={f(<FApprovals />)} />

            {/* Applicant workspace */}
            <Route path="organization" element={a(<Responsive desktop={<AOrganization />} phone={<AOrganizationPhone />} />)} />
            <Route path="find" element={a(<AFindFunding />)} />
            <Route path="applications/:appId/edit" element={a(<Responsive desktop={<AEditor />} phone={<AEditorPhone />} />)} />
            <Route path="applications/:appId/edit/submit" element={a(<AEditorSubmit />)} />
            <Route path="applications/:appId/submitted" element={a(<AConfirmation />)} />
            <Route path="grants/outside/:outsideId" element={a(<AOutsideAward />)} />
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
            {/* Write faster, win and keep it: the document vault and the funding summary. */}
            <Route path="organization/documents" element={a(<ADocuments />)} />
            <Route path="summary" element={a(<AFundingSummary />)} />
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
