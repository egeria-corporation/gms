// SPDX-License-Identifier: AGPL-3.0-only
// Which MCP tool a REST route stands for. A human gate is a property of the action, not of the
// transport: when a workspace (or an API client) adds a tool to its gated list, the same action
// called over REST with an agent or API-client token is refused exactly as the MCP dispatcher
// would hold it. `restTool` is consulted in one place, `svc()` in routes/http.ts.
type Row = readonly [method: string, pattern: RegExp, tool: string];

const ID = "[^/]+";
const r = (method: string, path: string, tool: string): Row => [method, new RegExp(`^${path.replace(/:id/g, ID)}$`), tool];

const ROWS: readonly Row[] = [
  // Funder
  r("POST", "/gms/opportunities", "create_opportunity"),
  r("PATCH", "/gms/opportunities/:id", "update_opportunity"),
  r("POST", "/gms/opportunities/:id/publish", "publish_opportunity"),
  r("POST", "/gms/competitions", "create_competition"),
  r("PUT", "/gms/competitions/:id/forms", "set_stage_forms"),
  r("PUT", "/gms/competitions/:id/stages", "set_stage_forms"),
  r("PUT", "/gms/competitions/:id/rubric", "set_rubric"),
  r("POST", "/gms/forms", "create_form"),
  r("PATCH", "/gms/forms/:id", "update_form"),
  r("POST", "/gms/applications/:id/advance", "advance_application"),
  r("POST", "/gms/applications/:id/request-revision", "request_revision"),
  r("POST", "/gms/applications/:id/decline", "decline_application"),
  r("POST", "/gms/applications/bulk", "decline_application"),
  r("POST", "/gms/applications/:id/tags", "tag_application"),
  r("POST", "/gms/review-assignments", "assign_reviewer"),
  r("POST", "/gms/review-assignments/auto", "assign_reviewer"),
  r("POST", "/gms/decisions/propose", "propose_decision"),
  r("POST", "/gms/decisions/commit", "commit_decisions"),
  r("POST", "/gms/awards", "create_award_from_application"),
  r("POST", "/gms/awards/direct", "create_direct_award"),
  r("POST", "/gms/awards/:id/invitation/resend", "create_direct_award"),
  r("POST", "/gms/awards/:id/amendments", "amend_award"),
  r("PATCH", "/gms/amendments/:id", "amend_award"),
  r("POST", "/gms/awards/:id/complete", "close_award"),
  r("POST", "/gms/awards/:id/agreements", "generate_agreement"),
  r("POST", "/gms/agreements/:id/send", "send_agreement"),
  r("POST", "/gms/agreements/:id/sign", "sign_agreement"),
  r("POST", "/gms/agreements/:id/countersign", "sign_agreement"),
  r("POST", "/gms/tranches/:id/release", "release_tranche"),
  r("POST", "/gms/tranches/:id/record-external", "record_external_payment"),
  r("POST", "/gms/submissions/:id/accept", "accept_submission"),
  r("POST", "/gms/submissions/:id/return", "return_submission"),
  r("POST", "/gms/requirements/:id/remind", "send_reminders"),
  r("POST", "/gms/requirements/remind-overdue", "send_reminders"),
  r("POST", "/gms/org-changes/:id/accept", "accept_org_change"),
  r("POST", "/gms/communications/send", "send_communication"),
  r("POST", "/gms/communications/bulk", "send_communication"),
  // Applicant
  r("POST", "/common-grants/applications/start", "start_application"),
  r("PUT", "/common-grants/applications/:id/forms/:id", "fill_form_response"),
  r("PUT", "/common-grants/applications/:id/submit", "submit_application"),
  r("POST", "/gms/my/applications/:id/attachments", "attach_document"),
  r("POST", "/gms/my/applications/:id/forms/:id/insert-answer", "insert_answer"),
  r("POST", "/gms/my/applications/:id/withdraw", "withdraw_application"),
  r("POST", "/gms/my/awards/:id/accept", "accept_award"),
  r("POST", "/gms/awards/:id/accept-offer", "accept_award"),
  r("POST", "/gms/my/awards/:id/amendments", "request_amendment"),
  r("PUT", "/gms/my/submissions/:id/forms/:id", "draft_submission"),
  r("POST", "/gms/my/submissions/:id/submit", "submit_requirement"),
  r("POST", "/gms/my/submissions/:id/share", "share_submission_with_funder"),
  r("POST", "/gms/my/answers", "save_answer"),
  r("PATCH", "/gms/my/answers/:id", "save_answer"),
  r("POST", "/gms/threads/:id/messages", "reply"),
];

/** The MCP tool a REST call stands for, or null for reads and routes no tool covers. */
export function restTool(method: string, pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  for (const [m, pattern, tool] of ROWS) if (m === method && pattern.test(path)) return tool;
  return null;
}

/** Tool names a workspace added to its gated list (`settings.gatedTools`). Gates are only ever added. */
export function workspaceGates(settings: unknown): string[] {
  const extra = (settings as { gatedTools?: unknown } | null)?.gatedTools;
  return Array.isArray(extra) ? extra.filter((t): t is string => typeof t === "string") : [];
}
