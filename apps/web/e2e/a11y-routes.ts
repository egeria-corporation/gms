// SPDX-License-Identifier: AGPL-3.0-only
// Every route in src/app/App.tsx, with the concrete addresses the accessibility check opens for it
// in mock mode, and who is signed in. `a11y-every-route.spec.ts` fails when App.tsx has a route
// that this table does not list, so a new screen cannot ship without being checked.
import type { Page } from "@playwright/test";

/**
 * Who is looking. The mock signs in one demo person who is an admin of the Riverbend funder
 * workspace and the Alder Creek applicant workspace, and a reviewer in Cascade County.
 * A program officer sees the same funder screens as an admin (src/lib/roles.ts hides nothing from
 * either), so the admin pass covers that role.
 */
export type Who = "funder-admin" | "funder-reviewer" | "applicant-admin" | "consultant" | "external-reviewer" | "guest-reviewer" | "signed-out";

export interface RouteCase {
  path: string;
  who: Who;
  /** Clicks that reach the state to check, after `path` has loaded. Mock state lives in the page. */
  steps?: (page: Page) => Promise<void>;
}

const F = "/w/riverbend";
const R = "/w/cascade-county";
const A = "/w/alder-creek";
const APP_F = "app_a0000000-0000-7000-8000-000000000001";
const APP_HEALTH = "app_90000000-0000-7000-8000-000000000001";
const APP_CLINIC = "app_90000000-0000-7000-8000-000000000002";
const AWD_F = "awd_b0000000-0000-7000-8000-000000000001";
const AWD_HARBOR = "awd_b0000000-0000-7000-8000-000000000002";
const AWD_HEALTH = "awd_a0000000-0000-7000-8000-000000000001";
const AWD_CLINIC = "awd_a0000000-0000-7000-8000-000000000002";
const OAP = (n: number) => `oap_d1000000-0000-7000-8000-00000000000${n}`;
const OPP = "opp_50000000-0000-7000-8000-000000000001";
const COMP = "cmp_60000000-0000-7000-8000-000000000001";
const PROGRAM = "40000000-0000-7000-8000-000000000001";
const FORM = "frm_70000000-0000-7000-8000-000000000001";
const GRANTEE = "20000000-0000-7000-8000-000000000011";
const SCORING = "e0000000-0000-7000-8000-000000000008";
const REQ = (n: number) => `req_d0000000-0000-7000-8000-00000000000${n}`;

/** Moves inside the single-page app without a reload, so the in-page mock state survives. */
export async function navigate(page: Page, href: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState(null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  }, href);
}

/** The sign-in screen's controls in either language (the every-route check runs in English and in Spanish). */
export const SIGN_IN = {
  email: /^(Work email|Correo de trabajo)$/,
  send: /^(Send code|Enviar el código)$/,
  code: /code|código/i,
  verify: /^(Verify and continue|Verificar y continuar)$/,
};

/** Signs in with the emailed code, as the mock accepts it. */
export async function signInWithCode(page: Page, email: string): Promise<void> {
  await page.getByLabel(SIGN_IN.email).fill(email);
  await page.getByRole("button", { name: SIGN_IN.send }).click();
  const digits = page.getByRole("group", { name: SIGN_IN.code }).getByRole("textbox");
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: SIGN_IN.verify }).click();
}

/** A guest reviewer: someone new who accepts an invitation to review and signs in with a code. */
const asGuest = (token: string, then?: (page: Page) => Promise<void>) => async (page: Page) => {
  await page.goto(`/invitations/accept?token=${token}`);
  await signInWithCode(page, "sam@newcomer.example");
  await page.waitForURL(/\/review\/welcome/);
  await then?.(page);
};

/** The demo person as a consultant scoped to one application in Alder Creek. */
const asConsultant = (href: string) => async (page: Page) => {
  await page.evaluate(async () => {
    const mock = (window as unknown as { __gmsMock: { me(): Promise<{ workspaces: { handle: string; role: string }[] }> } }).__gmsMock;
    const me = await mock.me();
    const alder = me.workspaces.find((w) => w.handle === "alder-creek");
    if (alder) alder.role = "consultant";
  });
  await navigate(page, href);
};

/** The funder lists its awards on its public page (off by default), then opens the list. Names in either language. */
const listAwards = (then?: (page: Page) => Promise<void>) => async (page: Page) => {
  const toggle = page.getByRole("switch", { name: /List awards on my public page|Publicar las subvenciones en mi página pública/ });
  await toggle.click();
  await page.getByRole("region", { name: /^(Grants awarded|Subvenciones otorgadas)$/ }).getByText(/1 listed|Publicadas: 1/).waitFor();
  await page.getByRole("link", { name: /Open your grants-awarded page|Abrir su página de subvenciones otorgadas/ }).click();
  await page.waitForURL(/\/f\/riverbend\/awards$/);
  await then?.(page);
};

/** A direct award's claim link, as the contact would receive it by email. */
const claimLink = async (page: Page) => {
  const link = await page.evaluate(async () => {
    const mock = (window as unknown as { __gmsMock: { createDirectAward(input: unknown): Promise<unknown>; outbox(): { link: string }[] } }).__gmsMock;
    await mock.createDirectAward({
      recipient: { organizationName: "Pine Ridge Youth Alliance", contactEmail: "maria@pineridge.example" },
      title: "Youth mentoring",
      amount: { value: "5000", currency: "USD" },
    });
    const url = new URL(mock.outbox().at(-1)!.link, location.origin);
    return url.pathname + url.search + url.hash;
  });
  await navigate(page, link);
};

const one = (path: string, who: Who, steps?: RouteCase["steps"]): RouteCase => ({ path, who, ...(steps ? { steps } : {}) });

/** Keyed by the route pattern exactly as App.tsx builds it (children of /w/:ws prefixed). */
export const ROUTES: Record<string, RouteCase[]> = {
  "/": [one("/", "signed-out")],
  "/f/:handle": [one("/f/riverbend", "signed-out")],
  "/f/:handle/o/:slug": [one("/f/riverbend/o/community-health-2027", "signed-out"), one("/f/riverbend/o/housing-stability-2027", "signed-out")],
  "/f/:handle/awards": [one("/f/riverbend/awards", "signed-out"), one(`${F}/settings/public-page`, "funder-admin", listAwards())],
  "/f/:handle/awards/:slug": [
    one(
      `${F}/settings/public-page`,
      "funder-admin",
      listAwards(async (page) => {
        await page.getByRole("link", { name: /Alder Creek Family Services/ }).first().click();
        await page.waitForURL(/\/f\/riverbend\/awards\/alder-creek/);
      }),
    ),
  ],
  "/f/:handle/:fundSlug": [one("/f/riverbend/default", "signed-out")],
  "/embed/f/:handle/o/:slug": [one("/embed/f/riverbend/o/community-health-2027", "signed-out"), one("/embed/f/riverbend/o/housing-stability-2027", "signed-out")],
  "/signin": [
    one("/signin", "signed-out"),
    one("/signin?as=funder", "signed-out"),
    one("/signin?step=sso", "signed-out"),
    one("/signin", "signed-out", async (page) => {
      await page.getByLabel(SIGN_IN.email).fill("sam@newcomer.example");
      await page.getByRole("button", { name: SIGN_IN.send }).click();
      await page.getByRole("group", { name: SIGN_IN.code }).waitFor();
    }),
  ],
  "/auth/passport": [one("/auth/passport#token_hash=used-already&type=magiclink", "signed-out")],
  "/agents": [one("/agents", "signed-out")],
  "/switch": [one("/switch", "signed-out")],
  "/switch/:system": [one("/switch/foundant", "signed-out")],
  "/workspaces": [one("/workspaces", "funder-admin")],
  "/consent": [one("/consent?req=preview", "funder-admin")],
  "/awards/claim": [one("/awards/claim?token=not-a-real-token", "signed-out"), one(F, "funder-admin", claimLink)],
  "/templates": [one("/templates", "signed-out")],
  "/templates/:slug": [one("/templates/small-grants-program-kit", "signed-out")],
  "/digests/unsubscribe": [one("/digests/unsubscribe#token=mock_unsubscribe_new_matches", "signed-out"), one("/digests/unsubscribe#token=v1.forged", "signed-out")],

  "/onboarding/funder": [one("/onboarding/funder", "funder-admin")],
  "/onboarding/funder/:step": ["organization", "brand", "team", "payments", "program"].map((s) => one(`/onboarding/funder/${s}`, "funder-admin")),
  "/onboarding/applicant": [one("/onboarding/applicant", "applicant-admin")],
  "/apply/:handle/:slug": [one("/apply/riverbend/community-health-2027", "applicant-admin")],
  "/invitations/accept": [one("/invitations/accept?token=gms_inv_mock_guest_reviewer", "signed-out")],
  "/invitations/draft": [one("/invitations/draft?token=gms_inv_mock_cowriter", "applicant-admin")],
  "/notifications": [one("/notifications", "funder-admin")],
  "/account": [one("/account", "funder-admin")],
  "/account/agents": [one("/account/agents", "funder-admin")],
  "/gallery/moderation": [one("/gallery/moderation", "funder-admin")],
  "/review/assignments": [one("/review/assignments", "funder-reviewer"), one("/", "guest-reviewer", asGuest("gms_inv_mock_guest_reviewer", async (page) => {
    await page.getByRole("button", { name: /Start reviewing|Empezar a revisar/ }).click();
    await page.waitForURL(/\/review\/assignments/);
  }))],
  "/review/score/:appId": [one(`/review/score/${SCORING}`, "funder-reviewer")],
  "/review/welcome": [one("/", "guest-reviewer", asGuest("gms_inv_mock_guest_reviewer")), one("/", "guest-reviewer", asGuest("gms_inv_mock_guest_done"))],
  "/review/done": [one("/", "guest-reviewer", asGuest("gms_inv_mock_guest_done", async (page) => {
    await page.getByRole("link", { name: /See what’s next|Ver qué sigue/ }).click();
    await page.waitForURL(/\/review\/done/);
  }))],

  "/w/:ws": [one(F, "funder-admin"), one(R, "funder-reviewer"), one(A, "applicant-admin")],
  "/w/:ws/applications/:appId": [one(`${F}/applications/${APP_F}`, "funder-admin"), one(`${R}/applications`, "funder-reviewer"), one(`${A}/applications/${APP_HEALTH}`, "applicant-admin"), one(`${A}/applications/${APP_CLINIC}`, "applicant-admin")],
  "/w/:ws/programs": [one(`${F}/programs`, "funder-admin")],
  "/w/:ws/programs/:programId": [one(`${F}/programs/${PROGRAM}`, "funder-admin")],
  "/w/:ws/opportunities": [one(`${F}/opportunities`, "funder-admin")],
  "/w/:ws/opportunities/new": [one(`${F}/opportunities/new`, "funder-admin")],
  "/w/:ws/opportunities/:oppId/edit": [
    one(`${F}/opportunities/${OPP}/edit`, "funder-admin"),
    one(`${F}/opportunities/${OPP}/edit#publish`, "funder-admin"),
    // Share this call (E2): the preview of the email to Philanthropy News Digest, shown in place.
    one(`${F}/opportunities/${OPP}/edit#publish`, "funder-admin", async (page) => {
      await page.getByRole("button", { name: /^(Preview the email to PND|Ver el correo para PND)$/ }).click();
      await page.getByRole("region", { name: /^(Email to|Correo para) Philanthropy News Digest$/ }).waitFor();
    }),
  ],
  "/w/:ws/opportunities/:oppId/competition": [one(`${F}/opportunities/${OPP}/competition`, "funder-admin")],
  "/w/:ws/forms": [one(`${F}/forms`, "funder-admin")],
  "/w/:ws/forms/:formId/edit": [one(`${F}/forms/${FORM}/edit`, "funder-admin")],
  "/w/:ws/competitions/:compId": [one(`${F}/competitions/${COMP}`, "funder-admin")],
  "/w/:ws/competitions/:compId/panel": [one(`${F}/competitions/${COMP}/panel`, "funder-admin")],
  "/w/:ws/applications": [one(`${F}/applications`, "funder-admin"), one(`${R}/applications`, "funder-reviewer"), one(`${A}/applications`, "applicant-admin"), one(`${A}/applications?view=board`, "applicant-admin"), one(`${A}/applications?view=calendar`, "applicant-admin")],
  "/w/:ws/applications/first-run": [one(`${F}/applications/first-run`, "funder-admin")],
  "/w/:ws/reviews/assign": [one(`${F}/reviews/assign`, "funder-admin")],
  "/w/:ws/awards": [one(`${F}/awards`, "funder-admin")],
  "/w/:ws/awards/new": [one(`${F}/awards/new`, "funder-admin")],
  "/w/:ws/awards/:awardId": [one(`${F}/awards/${AWD_F}`, "funder-admin")],
  "/w/:ws/awards/:awardId/agreement": [one(`${F}/awards/${AWD_F}/agreement`, "funder-admin")],
  "/w/:ws/awards/:awardId/payments": [one(`${F}/awards/${AWD_F}/payments`, "funder-admin"), one(`${F}/awards/${AWD_HARBOR}/payments`, "funder-admin")],
  "/w/:ws/payments": [one(`${F}/payments`, "funder-admin")],
  "/w/:ws/payments/due": [one(`${F}/payments/due`, "funder-admin")],
  "/w/:ws/payments/in-flight": [one(`${F}/payments/in-flight`, "funder-admin")],
  "/w/:ws/payments/reconcile": [one(`${F}/payments/reconcile`, "funder-admin")],
  "/w/:ws/payments/ledger": [one(`${F}/payments/ledger`, "funder-admin")],
  "/w/:ws/reporting": [one(`${F}/reporting`, "funder-admin"), one(`${F}/reporting?tab=received`, "funder-admin")],
  "/w/:ws/grantees": [one(`${F}/grantees`, "funder-admin")],
  "/w/:ws/grantees/:granteeId": [
    one(`${F}/grantees/${GRANTEE}`, "funder-admin"),
    // Imported history (v1.12.0): a past application opened in place, with its answers and reviews.
    one(`${F}/grantees/${GRANTEE}`, "funder-admin", async (page) => {
      await page.getByRole("button", { name: "After-school transport" }).click();
      await page.getByRole("table", { name: /^(Past applications|Solicitudes anteriores)$/ }).getByText("A van for after-school pick-up three days a week.").waitFor();
    }),
  ],
  "/w/:ws/analytics": [one(`${F}/analytics`, "funder-admin")],
  "/w/:ws/report-builder": [one(`${F}/report-builder`, "funder-admin")],
  "/w/:ws/communications": [one(`${F}/communications`, "funder-admin")],
  "/w/:ws/settings": [one(`${F}/settings`, "funder-admin"), one(`${A}/settings`, "applicant-admin")],
  "/w/:ws/settings/passport": [one(`${F}/settings/passport`, "funder-admin")],
  "/w/:ws/settings/mcp": [one(`${F}/settings/mcp`, "funder-admin")],
  "/w/:ws/settings/public-page": [one(`${F}/settings/public-page`, "funder-admin")],
  "/w/:ws/settings/security": [one(`${F}/settings/security`, "funder-admin")],
  "/w/:ws/settings/social": [one(`${F}/settings/social`, "funder-admin"), one(`${A}/settings/social`, "applicant-admin")],
  "/w/:ws/settings/funds": [one(`${F}/settings/funds`, "funder-admin")],
  "/w/:ws/settings/connectors": [one(`${F}/settings/connectors`, "funder-admin")],
  // Connected apps (v1.12.0): both kinds; the funder pass also opens the Slack settings once connected.
  "/w/:ws/settings/apps": [
    one(`${F}/settings/apps`, "funder-admin"),
    one(`${A}/settings/apps`, "applicant-admin"),
    {
      path: `${F}/settings/apps`,
      who: "funder-admin",
      steps: async (page) => {
        // The same steps run in English and Spanish.
        await page.getByRole("button", { name: /^(Connect Slack|Conectar Slack)$/ }).click();
        await page.getByRole("combobox", { name: /^(Channel|Canal)$/ }).waitFor();
      },
    },
  ],
  "/w/:ws/import": [one(`${F}/import`, "funder-admin"), one(`${A}/import`, "applicant-admin"), one(`${F}/import?target=history_reviews`, "funder-admin")],
  "/w/:ws/approvals": [one(`${F}/approvals`, "funder-admin")],

  "/w/:ws/organization": [one(`${A}/organization`, "applicant-admin")],
  "/w/:ws/find": [one(`${A}/find`, "applicant-admin")],
  "/w/:ws/applications/:appId/edit": [one(`${A}/applications/${APP_HEALTH}/edit`, "applicant-admin"), one("/workspaces", "consultant", asConsultant(`${A}/applications/${APP_HEALTH}/edit`))],
  "/w/:ws/applications/:appId/edit/submit": [one(`${A}/applications/${APP_HEALTH}/edit/submit`, "applicant-admin")],
  "/w/:ws/applications/:appId/submitted": [one(`${A}/applications/${APP_CLINIC}/submitted`, "applicant-admin")],
  "/w/:ws/grants/outside/:outsideId": [one(`${A}/grants/outside/${OAP(5)}`, "applicant-admin")],
  "/w/:ws/grants/:awardId": [one(`${A}/grants/${AWD_HEALTH}`, "applicant-admin"), one(`${A}/grants/${AWD_CLINIC}`, "applicant-admin")],
  "/w/:ws/grants": [one(`${A}/grants`, "applicant-admin")],
  "/w/:ws/grants/:awardId/offer": [one(`${A}/grants/${AWD_HEALTH}/offer`, "applicant-admin")],
  "/w/:ws/reports": [one(`${A}/reports`, "applicant-admin"), one(`${A}/reports?r=${REQ(3)}`, "applicant-admin"), one(`${A}/reports?r=${REQ(4)}`, "applicant-admin")],
  "/w/:ws/library": [one(`${A}/library`, "applicant-admin")],
  "/w/:ws/team": [one(`${A}/team`, "applicant-admin")],
  "/w/:ws/funders": [one(`${A}/funders`, "applicant-admin")],
  "/w/:ws/funders/:recordId": [one(`${A}/funders/fdr_d2000000-0000-7000-8000-000000000001`, "applicant-admin")],
  "/w/:ws/outside/:outsideId": [
    one(`${A}/outside/${OAP(1)}`, "applicant-admin"),
    one(`${A}/outside/${OAP(1)}?tab=checklist`, "applicant-admin"),
    one(`${A}/outside/${OAP(1)}?tab=notes`, "applicant-admin"),
    one(`${A}/outside/${OAP(1)}?tab=activity`, "applicant-admin"),
    one(`${A}/outside/${OAP(3)}?tab=submission`, "applicant-admin"),
    one(`${A}/outside/${OAP(5)}`, "applicant-admin"),
    one(`${A}/outside/${OAP(6)}`, "applicant-admin"),
    one(`${A}/outside/${OAP(7)}`, "applicant-admin"),
    one("/workspaces", "consultant", asConsultant(`${A}/outside/${OAP(1)}`)),
  ],
  "/w/:ws/organization/documents": [one(`${A}/organization/documents`, "applicant-admin")],
  "/w/:ws/summary": [one(`${A}/summary`, "applicant-admin")],

  // Demo (mock) mode only: the design reference boards and the email and PDF templates.
  "/styleguide/form": [one("/styleguide/form", "funder-admin")],
  "/styleguide/status": [one("/styleguide/status", "funder-admin")],
  "/styleguide/components-a": [one("/styleguide/components-a", "funder-admin")],
  "/styleguide/components-b": [one("/styleguide/components-b", "funder-admin")],
  "/styleguide/approval-flow": [one("/styleguide/approval-flow", "funder-admin")],
  "/styleguide/passport-consent": [one("/styleguide/passport-consent", "funder-admin")],
  "/preview/email/:kind": ["acknowledgment", "revision-request", "decline", "award", "report-reminder", "payment-sent"].map((k) => one(`/preview/email/${k}`, "funder-admin")),
  "/preview/pdf/:kind": ["application-snapshot", "agreement", "closeout"].map((k) => one(`/preview/pdf/${k}`, "funder-admin")),

  // The catch-all.
  "*": [one("/no-such-page", "signed-out"), one("/w/harbor-light", "funder-admin")],
};

/** A dialog or menu, and the control that opens it. Found by clicking every button on every route. */
export interface DialogCase {
  path: string;
  who: Who;
  /** The opener's accessible name: a string matches exactly. The first match is used. */
  opener: string | RegExp;
  /** The dialog's accessible name, exactly. */
  dialog: string;
  /** The same two names in Spanish: the dialogs are checked in both languages. Names of content (a form, a fund, a file) stay as written. */
  es: { opener: string | RegExp; dialog: string };
  role?: "dialog" | "menu";
}

const ED = `${A}/applications/${APP_HEALTH}/edit`;
const NW = "/invitations/draft?token=gms_inv_mock_cowriter";
const OA5 = `${A}/grants/outside/${OAP(5)}`;
const es = (opener: string | RegExp, dialog: string) => ({ opener, dialog });
const d = (path: string, who: Who, opener: string | RegExp, dialog: string, spanish: DialogCase["es"], role?: "menu"): DialogCase => ({ path, who, opener, dialog, es: spanish, ...(role ? { role } : {}) });

/** Every distinct dialog the crawl reached (2026-11-16), plus the workspace menu. */
export const DIALOGS: DialogCase[] = [
  d(A, "applicant-admin", "Alder Creek Family Services Applicant", "Switch workspace", es("Alder Creek Family Services Solicitante", "Cambiar de espacio de trabajo"), "menu"),
  d(NW, "applicant-admin", "Mark as submitted", "Mark as submitted", es("Marcar como enviada", "Marcar como enviada")),
  d(NW, "applicant-admin", "Send to the funder", "Send to the funder", es("Enviar al financiador", "Enviar al financiador")),
  d(NW, "applicant-admin", "Get help writing this", "Get help writing this", es("Pedir ayuda para escribirla", "Pedir ayuda para escribirla")),
  d(NW, "applicant-admin", "Edit details", "Edit details", es("Editar detalles", "Editar detalles")),
  d(NW, "applicant-admin", "Paste questions", "Paste the funder’s questions", es("Pegar preguntas", "Pegar las preguntas del financiador")),
  d(NW, "applicant-admin", "Invite a teammate", "Invite someone to help write this", es("Invitar a alguien del equipo", "Invitar a alguien a ayudar a escribir esto")),
  d("/account/agents", "funder-admin", "Revoke Claude in Alder Creek Family Services", "Revoke Claude?", es("Revocar Claude en Alder Creek Family Services", "¿Revocar Claude?")),
  d("/review/assignments", "funder-reviewer", "Declare conflicts and open", "Conflict of interest declaration", es("Declarar conflictos y abrir", "Declaración de conflicto de intereses")),
  d(`${A}/applications/${APP_HEALTH}`, "applicant-admin", "Withdraw application", "Withdraw this application?", es("Retirar la solicitud", "¿Retirar esta solicitud?")),
  d(`${F}/programs`, "funder-admin", "New program", "New program", es("Nuevo programa", "Nuevo programa")),
  d(`${F}/programs/${PROGRAM}`, "funder-admin", "Edit program", "Edit program", es("Editar el programa", "Editar el programa")),
  d(`${F}/opportunities/${OPP}/competition`, "funder-admin", "Edit stages", "Edit stages", es("Editar las etapas", "Editar las etapas")),
  d(`${F}/opportunities/${OPP}/competition`, "funder-admin", /^Share to the gallery\W+LOI screening rubric$/, "Share “LOI screening rubric” to the gallery", es(/^Compartir en la galería\W+LOI screening rubric$/, "Compartir «LOI screening rubric» en la galería")),
  d(`${F}/forms/${FORM}/edit`, "funder-admin", "Version history", "Version history", es("Historial de versiones", "Historial de versiones")),
  d(`${F}/forms/${FORM}/edit`, "funder-admin", /^Share to the gallery\W+Letter of intent$/, "Share “Letter of intent” to the gallery", es(/^Compartir en la galería\W+Letter of intent$/, "Compartir «Letter of intent» en la galería")),
  d(`${F}/competitions/${COMP}/panel`, "funder-admin", "Board docket…", "Board docket", es("Carpeta para la junta…", "Carpeta para la junta")),
  d(`${A}/applications`, "applicant-admin", "New application", "New application", es("Nueva solicitud", "Nueva solicitud")),
  d(`${F}/reviews/assign`, "funder-admin", "Auto-assign…", "Auto-assign reviewers", es("Asignar automáticamente…", "Asignar revisores automáticamente")),
  d(`${F}/reviews/assign`, "funder-admin", "Invite external reviewer…", "Invite an external reviewer", es("Invitar a un(a) revisor(a) externo(a)…", "Invitar a un(a) revisor(a) externo(a)")),
  d(`${F}/reviews/assign`, "funder-admin", "Conflict-of-interest policy…", "Conflict-of-interest policy", es("Política de conflictos de intereses…", "Política de conflictos de intereses")),
  d(`${F}/reviews/assign`, "funder-admin", "Conflicts register…", "Conflicts register", es("Registro de conflictos…", "Registro de conflictos")),
  d(`${F}/awards`, "funder-admin", "Countersign…", "Countersign the grant agreement", es("Refrendar…", "Refrendar el convenio de subvención")),
  d(`${F}/awards/${AWD_F}/payments`, "funder-admin", "Edit schedule", "Edit the payment schedule", es("Editar el calendario", "Editar el calendario de pagos")),
  d(`${F}/awards/${AWD_F}/payments`, "funder-admin", "Hold", "Hold tranche 1", es("Retener", "Retener el tramo 1")),
  d(`${F}/awards/${AWD_F}/payments`, "funder-admin", "Cancel tranche", "Cancel tranche 1", es("Cancelar el tramo", "Cancelar el tramo 1")),
  d(`${F}/payments/due`, "funder-admin", "Record a payment made outside the GMS", "Record a payment made outside Passport", es("Registrar un pago hecho fuera del GMS", "Registrar un pago hecho fuera de Passport")),
  d(`${F}/payments/in-flight`, "funder-admin", "Match", "Match this bank transaction", es("Conciliar", "Conciliar esta transacción bancaria")),
  d(`${F}/grantees`, "funder-admin", "Propose a change", "Propose a change to Alder Creek Family Services", es("Proponer un cambio", "Proponer un cambio a Alder Creek Family Services")),
  d(`${F}/report-builder`, "funder-admin", "Save view", "Save view", es("Guardar la vista", "Guardar la vista")),
  d(`${F}/communications`, "funder-admin", "Send to 4", "Send “Standard decline v3” to 4 recipients?", es("Enviar a 4", "¿Enviar «Standard decline v3» a 4 destinatarios?")),
  d(`${A}/settings`, "applicant-admin", "Create token", "Create an API token", es("Crear el token", "Crear un token de API")),
  d(`${A}/settings`, "applicant-admin", "Leave workspace", "Leave Alder Creek Family Services?", es("Salir del espacio de trabajo", "¿Salir de Alder Creek Family Services?")),
  d(`${F}/settings/funds`, "funder-admin", "New fund", "New fund", es("Nuevo fondo", "Nuevo fondo")),
  d(`${F}/settings/funds`, "funder-admin", "Edit Default fund", "Edit Default fund", es("Editar Default fund", "Editar Default fund")),
  d(`${F}/settings/funds`, "funder-admin", "Budget for Default fund", "Budget for Default fund", es("Presupuesto de Default fund", "Presupuesto de Default fund")),
  d(`${F}/settings/funds`, "funder-admin", "Invite an advisor for Default fund", "Advisor for Default fund", es("Invitar a un(a) asesor(a) para Default fund", "Asesor(a) de Default fund")),
  d(ED, "applicant-admin", "Submit…", "Ready to submit?", es("Enviar…", "¿Lista para enviar?")),
  d(ED, "applicant-admin", "Insert from answer library", "Insert from answer library", es("Insertar desde la biblioteca de respuestas", "Insertar desde la biblioteca de respuestas")),
  d(OA5, "applicant-admin", "Add an obligation", "Add an obligation", es("Agregar una obligación", "Agregar una obligación")),
  d(OA5, "applicant-admin", "Mark submitted", "Mark the report submitted", es("Marcar como enviado", "Marcar el informe como enviado")),
  d(OA5, "applicant-admin", "Edit Second payment", "Edit Second payment", es("Editar Second payment", "Editar Second payment")),
  d(`${A}/grants`, "applicant-admin", "Review and sign", "Sign the grant agreement", es("Revisar y firmar", "Firmar el convenio de subvención")),
  d(`${A}/reports?r=${REQ(3)}`, "applicant-admin", "Share this report", "Share “Mid-year progress report”", es("Compartir este informe", "Compartir «Mid-year progress report»")),
  d(`${A}/funders`, "applicant-admin", "Add a funder", "Add a funder", es("Agregar un financiador", "Agregar un financiador")),
  d(`${A}/outside/${OAP(3)}?tab=submission`, "applicant-admin", "Record decision", "Record the decision", es("Registrar la decisión", "Registrar la decisión")),
  d(`${A}/organization/documents`, "applicant-admin", "Add a document", "Add a document to the vault", es("Agregar un documento", "Agregar un documento al archivo")),
  d(`${A}/organization/documents`, "applicant-admin", "Edit Board of directors 2026.pdf", "Board of directors 2026.pdf", es("Editar Board of directors 2026.pdf", "Board of directors 2026.pdf")),
];
