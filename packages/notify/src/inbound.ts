// SPDX-License-Identifier: AGPL-3.0-only
// Reply-to-thread: outbound mail carries `thread+<id>@<inbound domain>` as Reply-To; inbound mail
// (Resend webhook) is matched to its thread by that address, then by Message-ID references.

const THREAD_ID = /^[0-9A-Za-z_-]{6,64}$/;

export function threadReplyAddress(threadId: string, inboundDomain: string): string {
  if (!THREAD_ID.test(threadId)) throw new Error("Thread id is not address-safe.");
  return `thread+${threadId}@${inboundDomain.toLowerCase()}`;
}

/** Extracts the bare address from `Name <addr>` or `addr`. */
export function bareAddress(value: string): string {
  const angle = /<([^<>\s]+)>\s*$/.exec(value.trim());
  return (angle ? angle[1]! : value.trim()).toLowerCase();
}

export function threadIdFromAddress(address: string, inboundDomain: string): string | null {
  const bare = bareAddress(address);
  const at = bare.lastIndexOf("@");
  if (at < 0 || bare.slice(at + 1) !== inboundDomain.toLowerCase()) return null;
  const local = bare.slice(0, at);
  if (!local.startsWith("thread+")) return null;
  // Addresses are lowercased in transit; thread ids are matched case-insensitively by the caller's store.
  const id = local.slice("thread+".length);
  return THREAD_ID.test(id) ? id : null;
}

function messageIds(header: string | string[] | undefined): string[] {
  if (!header) return [];
  const text = Array.isArray(header) ? header.join(" ") : header;
  return (text.match(/<[^<>\s]+>/g) ?? []).map((m) => m.toLowerCase());
}

export interface InboundEmail {
  from: string;
  to: string[];
  cc?: string[];
  inReplyTo?: string;
  references?: string | string[];
}

export type InboundMatch = { threadId: string; via: "address" | "message_id"; from: string } | null;

/** `findThreadByMessageId` looks up `messages.email_message_id`. The caller still has to check
 * that `from` belongs to a participant of the thread before posting the reply. */
export async function matchInbound(email: InboundEmail, options: { inboundDomain: string; findThreadByMessageId: (messageId: string) => Promise<string | null> }): Promise<InboundMatch> {
  const from = bareAddress(email.from);
  for (const address of [...email.to, ...(email.cc ?? [])]) {
    const threadId = threadIdFromAddress(address, options.inboundDomain);
    if (threadId) return { threadId, via: "address", from };
  }
  // In-Reply-To first, then References newest to oldest.
  for (const id of [...messageIds(email.inReplyTo), ...messageIds(email.references).reverse()]) {
    const threadId = await options.findThreadByMessageId(id);
    if (threadId) return { threadId, via: "message_id", from };
  }
  return null;
}

/** Drops the quoted history from a plain-text reply so the thread shows only the new text. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^On .+ wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) || /^>/.test(l));
  return (cut < 0 ? lines : lines.slice(0, cut)).join("\n").trim();
}
