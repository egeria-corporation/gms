// SPDX-License-Identifier: AGPL-3.0-only
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { GuardedMailer, bareAddress, isDeliverableOutsideProduction, parseAllowlist } from '../src/mail/guard';
import { MailProviderError, ResendMailer, signSvixPayload, verifySvixSignature } from '../src/mail/resend';
import { SmtpMailer } from '../src/mail/smtp';
import type { MailMessage, Mailer, MailResult } from '../src/types';

class RecordingMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(readonly name: MailResult['provider']) {}
  async send(msg: MailMessage): Promise<MailResult> {
    this.sent.push(msg);
    return { provider: this.name, messageId: `${this.name}-${this.sent.length}` };
  }
}

const msg = (to: string, extra: Partial<MailMessage> = {}): MailMessage => ({
  to,
  from: 'grants@halcyon.example',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  ...extra,
});

describe('GuardedMailer', () => {
  it('delivers only to @resend.dev and allowlisted hosts outside production', async () => {
    const real = new RecordingMailer('resend');
    const outbox = new RecordingMailer('dev-outbox');
    const g = new GuardedMailer(real, outbox, { production: false, allowlist: ['qa.example', 'someone@team.example'] });
    await g.send(msg('delivered@resend.dev'));
    await g.send(msg('Tester <bounced@resend.dev>'));
    await g.send(msg('anyone@qa.example'));
    await g.send(msg('someone@team.example'));
    await g.send(msg('other@team.example'));
    await g.send(msg('real.person@gmail.com', { tags: { kind: 'decision' } }));
    await g.send(msg('a@resend.dev.evil.example'));
    await g.send(msg('a@resend.dev, b@gmail.com'));
    expect(real.sent.map((m) => m.to)).toEqual(['delivered@resend.dev', 'Tester <bounced@resend.dev>', 'anyone@qa.example', 'someone@team.example']);
    expect(outbox.sent.map((m) => m.to)).toEqual(['other@team.example', 'real.person@gmail.com', 'a@resend.dev.evil.example', 'a@resend.dev, b@gmail.com']);
    expect(outbox.sent[1]!.tags).toEqual({ kind: 'decision', redirected: 'true', intended_provider: 'resend' });
  });

  it('strips recipient headers so the guard cannot be bypassed', async () => {
    const real = new RecordingMailer('smtp');
    const g = new GuardedMailer(real, new RecordingMailer('dev-outbox'), { production: false, allowlist: [] });
    await g.send(msg('delivered@resend.dev', { headers: { Bcc: 'victim@gmail.com', CC: 'x@y.com', 'X-Entity-Ref': '1' } }));
    expect(real.sent[0]!.headers).toEqual({ 'X-Entity-Ref': '1' });
  });

  it('passes everything through in production', async () => {
    const real = new RecordingMailer('resend');
    const outbox = new RecordingMailer('dev-outbox');
    const g = new GuardedMailer(real, outbox, { production: true });
    await g.send(msg('real.person@gmail.com'));
    expect(real.sent).toHaveLength(1);
    expect(outbox.sent).toHaveLength(0);
  });

  it('parses addresses and allowlists', () => {
    expect(parseAllowlist(' qa.example, @Team.Example ')).toEqual(['qa.example', 'team.example']);
    expect(bareAddress('Name <A@B.example>')).toBe('a@b.example');
    expect(bareAddress('not an address')).toBeNull();
    expect(isDeliverableOutsideProduction('x@RESEND.dev', [])).toBe(true);
    expect(isDeliverableOutsideProduction('x@sub.qa.example', ['qa.example'])).toBe(false);
  });
});

describe('ResendMailer', () => {
  it('posts the documented payload and returns the message id', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const m = new ResendMailer({
      apiKey: 're_test_key_123',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
      },
    });
    const r = await m.send(msg('delivered@resend.dev', { fromName: 'Halcyon "Fund"', replyTo: 'ops@halcyon.example', workspaceId: 'ws-1', tags: { kind: 'magic link' } }));
    expect(r).toEqual({ provider: 'resend', messageId: 'msg_1' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer re_test_key_123');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ from: '"Halcyon Fund" <grants@halcyon.example>', to: ['delivered@resend.dev'], reply_to: 'ops@halcyon.example' });
    expect(body.tags).toEqual([
      { name: 'kind', value: 'magic_link' },
      { name: 'workspace_id', value: 'ws-1' },
    ]);
  });

  it('raises a provider error without leaking the key', async () => {
    const m = new ResendMailer({
      apiKey: 're_secret_key_999',
      fetch: async () => new Response(JSON.stringify({ message: 'API key re_secret_key_999 is invalid' }), { status: 401 }),
    });
    const err = (await m.send(msg('delivered@resend.dev')).catch((e: unknown) => e)) as MailProviderError;
    expect(err).toBeInstanceOf(MailProviderError);
    expect(err.message).not.toContain('re_secret_key_999');
    expect(JSON.stringify(m)).not.toContain('re_secret_key_999');
  });
});

describe('Svix webhook verification (Resend)', () => {
  const secret = `whsec_${Buffer.from('a-32-byte-test-secret-for-svix!!').toString('base64')}`;
  const body = '{"type":"email.bounced","data":{"email_id":"msg_1"}}';
  const now = new Date('2026-09-27T12:00:00Z');

  it('accepts valid signatures', () => {
    const headers = signSvixPayload(body, secret, 'msg_abc', now);
    expect(verifySvixSignature(body, headers, secret, now)).toBe(true);
    expect(new ResendMailer({ apiKey: 'k' }).verifyWebhook(body, signSvixPayload(body, secret, 'msg_abc'), secret)).toBe(true);
    // Multiple signatures (key rotation).
    expect(verifySvixSignature(body, { ...headers, 'svix-signature': `v1,AAAA ${headers['svix-signature']!}` }, secret, now)).toBe(true);
  });

  it('rejects tampering, wrong secret, missing headers and old timestamps', () => {
    const headers = signSvixPayload(body, secret, 'msg_abc', now);
    expect(verifySvixSignature(body.replace('bounced', 'delivered'), headers, secret, now)).toBe(false);
    expect(verifySvixSignature(body, headers, `whsec_${Buffer.from('other').toString('base64')}`, now)).toBe(false);
    expect(verifySvixSignature(body, { 'svix-id': 'msg_abc', 'svix-timestamp': headers['svix-timestamp']! }, secret, now)).toBe(false);
    expect(verifySvixSignature(body, headers, secret, new Date(now.getTime() + 6 * 60_000))).toBe(false);
    expect(verifySvixSignature(body, { ...headers, 'svix-id': 'msg_other' }, secret, now)).toBe(false);
  });
});

describe('SmtpMailer', () => {
  it('sends through a nodemailer transport with tags as headers', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const m = new SmtpMailer({ transport });
    const r = await m.send(msg('delivered@resend.dev', { fromName: 'Halcyon', tags: { kind: 'decision' }, workspaceId: 'ws-9' }));
    expect(r.provider).toBe('smtp');
    expect(r.messageId).toBeTruthy();
    expect(() => new SmtpMailer({})).toThrow(/SMTP_URL/);
  });

  it('redacts credentials from transport errors', async () => {
    const transport = nodemailer.createTransport({ host: '127.0.0.1', port: 1, connectionTimeout: 500, auth: { user: 'u', pass: 'p' } });
    const m = new SmtpMailer({ transport });
    const err = (await m.send(msg('delivered@resend.dev')).catch((e: unknown) => e)) as MailProviderError;
    expect(err).toBeInstanceOf(MailProviderError);
    expect(err.message).not.toContain('pass');
  });
});

describe.skipIf(!process.env.RESEND_API_KEY)('ResendMailer (live)', () => {
  it('delivers to delivered@resend.dev only', async () => {
    const m = new ResendMailer({ apiKey: process.env.RESEND_API_KEY! });
    const r = await m.send({ to: 'delivered@resend.dev', from: process.env.RESEND_TEST_FROM ?? 'onboarding@resend.dev', subject: 'GMS live test', html: '<p>GMS live test</p>', text: 'GMS live test' });
    expect(r.messageId).toBeTruthy();
  });
});
