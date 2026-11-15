// SPDX-License-Identifier: AGPL-3.0-only
// Send to the funder (C4), for an applicant workspace: an outside application as a package for a
// funder who is not on the GMS. A PDF (cover, questions and answers, budget summary, attachment
// list) and a ZIP (the PDF, the attached files, answers.txt), to download, or to email to an
// address the person types, under their name, after a preview. Emailing is a person's only.
//
// `createHttpSendPackageApi` calls the GMS Worker (api/send-package.tsp);
// `createMockSendPackageApi` (mocks/sendPackage.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";

export interface Money {
  amount: string;
  currency: string;
}

export interface PackageFile {
  documentId: string;
  name: string;
  originalName: string;
  source: "application" | "vault";
  requiredFor: string | null;
  mime: string;
  size: number;
  sha256: string;
}

export interface PackageBlocked {
  questionId: string;
  number: number;
  prompt: string;
  reason: "bank_routing" | "identity_number" | "long_number";
  message: string;
}

export interface SendPackage {
  applicationId: string;
  title: string;
  cover: { organization: string; funder: string | null; program: string | null; ask: Money | null; askPrinted: string | null; deadlines: { label: string; date: string }[]; answersAsOf: string };
  questions: { id: string; number: number; phase: "loi" | "full" | "report"; prompt: string; answered: boolean }[];
  budget: { byYear: { year: number; amount: Money }[]; total: string } | null;
  attachments: PackageFile[];
  notIncluded: { documentId: string; name: string; reason: "passport_locker" | "sensitive_name"; message: string }[];
  footer: { shown: boolean; text: string; canChange: boolean };
  blocked: PackageBlocked[];
  files: { pdf: string; zip: string; contents: string[] };
  totalBytes: number;
  downloads: { pdf: string; zip: string };
  email: { available: boolean; reason: string | null; perDay: number; sentToday: number; remainingToday: number; maxBytes: number };
}

export interface PackageEmailInput {
  to: string;
  message?: string;
}

export interface PackageEmailPreview {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; contentType: string; sha256: string; size: number }[];
  digest: string;
  perDay: number;
  remainingToday: number;
}

export interface PackageEmailSent {
  sent: true;
  sendId: string;
  sentAt: string;
  to: string;
  replyTo: string;
  remainingToday: number;
}

export interface PackageDownload {
  blob: Blob;
  filename: string;
}

export interface SendPackageApi {
  get(outsideId: string): Promise<SendPackage>;
  download(outsideId: string, kind: "pdf" | "zip"): Promise<PackageDownload>;
  previewEmail(outsideId: string, input: PackageEmailInput): Promise<PackageEmailPreview>;
  sendEmail(outsideId: string, input: PackageEmailInput & { digest: string }): Promise<PackageEmailSent>;
  setFooter(poweredBy: boolean): Promise<{ poweredBy: boolean }>;
}

export interface HttpSendPackageOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

/** Outside application ids travel as bare UUIDs; the web keeps them prefixed (`oap_…`). */
const bare = (id: string) => id.replace(/^oap_/, "");

export function createHttpSendPackageApi(opts: HttpSendPackageOptions): SendPackageApi {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
      throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    }
    return res;
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const json = (await (await request(method, path, body)).json()) as { data?: T };
    return json.data as T;
  }
  const pkg = (id: string) => `/gms/outside-applications/${encodeURIComponent(bare(id))}/package`;
  return {
    get: (id) => call("GET", pkg(id)),
    async download(id, kind) {
      const res = await request("GET", `${pkg(id)}.${kind}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `package.${kind}`;
      return { blob: await res.blob(), filename: name };
    },
    previewEmail: (id, input) => call("POST", `${pkg(id)}/email/preview`, input),
    sendEmail: (id, input) => call("POST", `${pkg(id)}/email`, input),
    setFooter: (poweredBy) => call("PUT", "/gms/send-package/settings", { poweredBy }),
  };
}
