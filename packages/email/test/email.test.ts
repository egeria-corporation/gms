// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  MERGE_FIELDS,
  TEMPLATE_KEYS,
  contrastRatio,
  markdownToHtml,
  markdownToText,
  parseHex,
  previewProps,
  renderEmail,
  renderMergeFields,
  resolveBrand,
  safeUrl,
  templates,
  type Brand,
  type TemplateKey,
  type TemplateProps,
} from '../src';

const brand: Brand = {
  displayName: 'Halcyon Ridge Foundation',
  logoUrl: 'https://halcyon-ridge.example/logo.png',
  primaryColor: '#1f6f5c',
  accentColor: '#e0a526',
  headingFont: 'Fraunces',
  replyTo: 'grants@halcyon-ridge.example',
  sourceUrl: 'https://git.halcyon-ridge.example/gms',
};

async function renderPreview<K extends TemplateKey>(key: K, b: Brand = brand) {
  return renderEmail(key, previewProps[key] as TemplateProps<K>, b);
}

describe('templates', () => {
  it('registers every required template', () => {
    expect([...TEMPLATE_KEYS].sort()).toEqual(
      [
        'agent_confirmation_request',
        'agreement_ready',
        'approval_needed',
        'award_notice',
        'bulk_message',
        'collaborator_invite',
        'deadline_reminder',
        'magic_link',
        'message_notification',
        'payee_onboarding',
        'payment_sent',
        'report_due',
        'report_overdue',
        'revisions_requested',
        'staff_invite',
        'status_change',
        'submission_receipt',
      ].sort(),
    );
  });

  for (const key of TEMPLATE_KEYS) {
    it(`${key} renders html + text from its preview props`, async () => {
      const out = await renderPreview(key);
      expect(out.subject.length).toBeGreaterThan(5);
      expect(out.subject).not.toMatch(/[\r\n]/);
      expect(out.html).toMatch(/^<!DOCTYPE html/i);
      expect(out.html).toContain('Powered by GMS');
      expect(out.html).toContain('https://git.halcyon-ridge.example/gms');
      expect(out.html).toContain('name="color-scheme" content="light dark"');
      expect(out.html).toContain('max-width:600px');
      expect(out.html).toContain('Halcyon Ridge Foundation');
      expect(out.html).toContain('getting this email because');
      expect(out.html.toLowerCase()).not.toContain('<script');
      expect(out.html).not.toContain('{{');
      expect(out.text).toContain('Powered by GMS');
      expect(out.text).toContain('Source code: https://git.halcyon-ridge.example/gms');
      expect(out.text).toContain('getting this email because');
      expect(out.text).not.toMatch(/<[a-z]/i);
      // Fixtures only use reserved domains.
      for (const m of out.html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        expect(m[1]!.endsWith('.example') || m[1] === 'www.w3.org').toBe(true);
      }
    });
  }

  it('keeps the footer and uses a fallback source URL even with a hostile brand', async () => {
    const out = await renderPreview('magic_link', {
      displayName: '<script>alert(1)</script>',
      logoUrl: 'javascript:alert(1)',
      primaryColor: 'red; background:url(x)',
      accentColor: 'nope',
      headingFont: "Evil'; } body { display:none",
      sourceUrl: 'javascript:alert(1)',
    });
    expect(out.html.toLowerCase()).not.toContain('<script');
    expect(out.html).not.toContain('javascript:');
    expect(out.html).not.toContain('url(x)');
    expect(out.html).toContain('Powered by GMS');
    expect(out.html).toContain('https://github.com/egeria-corporation/gms');
    expect(out.html).not.toContain('<img');
  });

  it('renders the logo with alt text when provided', async () => {
    const out = await renderPreview('award_notice');
    expect(out.html).toMatch(/<img[^>]+alt="Halcyon Ridge Foundation"/);
    expect(out.html).not.toMatch(/background-image/i);
  });

  it('includes the preheader text', async () => {
    const out = await renderPreview('submission_receipt');
    expect(out.html).toContain('Your reference number is YAF27-0042');
  });

  it('shows a submission timestamp in the workspace timezone', async () => {
    const out = await renderPreview('submission_receipt');
    expect(out.text).toContain('Nov 18, 2026, 2:41 PM PST');
  });

  it('has tailored copy for every application status, including info requested', async () => {
    const statuses = [
      'info_requested',
      'in_progress',
      'submitted',
      'under_review',
      'invited_to_next_stage',
      'awarded',
      'declined',
      'withdrawn',
      'ineligible',
    ] as const;
    const subjects = new Set<string>();
    for (const status of statuses) {
      const out = await renderEmail(
        'status_change',
        { ...templates.status_change.previewProps, status },
        brand,
      );
      subjects.add(out.subject);
      expect(out.text).toContain('What happens next');
    }
    expect(subjects.size).toBe(statuses.length);
  });

  it('payee onboarding names Mercury in text and explains GMS never sees bank numbers', async () => {
    const out = await renderPreview('payee_onboarding');
    expect(out.text).toContain('Mercury');
    expect(out.text.replace(/\s+/g, ' ')).toContain(
      'GMS never sees or stores your account or routing numbers',
    );
  });

  it('agent confirmation shows the agent name and exact action', async () => {
    const out = await renderPreview('agent_confirmation_request');
    expect(out.text).toContain('Grant Assistant');
    expect(out.html).toContain(
      'Submit the application “After-School Strings Program” to Youth Arts Fund 2027.',
    );
    expect(out.text).toContain('Nothing happens until you confirm');
  });

  it('formats money with formatMoney', async () => {
    const out = await renderPreview('payment_sent');
    expect(out.text).toContain('$12,500.00');
  });

  it('bulk message applies merge fields without letting values inject markup', async () => {
    const out = await renderEmail(
      'bulk_message',
      {
        ...templates.bulk_message.previewProps,
        mergeValues: {
          'applicant.first_name': '<img src=x onerror=alert(1)> [x](javascript:alert(1)) **bold**',
          'opportunity.name': 'Fund',
        },
      },
      brand,
    );
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out.html).not.toMatch(/href="javascript:/i);
    // The value shows up as literal text, not as a link.
    expect(out.html).toContain('[x](javascript:alert(1))');
    expect(out.html).not.toContain('<strong>bold</strong>');
    expect(out.html).toContain('<strong>free online info session</strong>');
    expect(out.subject).toBe('Info session for Fund');
  });

  it('never tracks: no pixel-sized images or tracking params', async () => {
    for (const key of TEMPLATE_KEYS) {
      const out = await renderPreview(key);
      const imgs = out.html.match(/<img[^>]*>/g) ?? [];
      expect(imgs.length).toBeLessThanOrEqual(1);
      expect(out.html).not.toMatch(/width="1"|height="1"/);
      expect(out.html).not.toMatch(/utm_/);
    }
  });
});

describe('markdown subset', () => {
  it('renders paragraphs, bold, italic, links and lists', () => {
    const html = markdownToHtml(
      'Hello **world** and *you*.\n\n- one\n- two\n\n1. first\n2. second\n\n[site](https://a.example/x)',
    );
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<em>you</em>');
    expect(html).toMatch(/<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/);
    expect(html).toMatch(/<ol[^>]*><li[^>]*>first<\/li>/);
    expect(html).toContain('href="https://a.example/x"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes <script> and raw HTML', () => {
    const html = markdownToHtml('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)> <b>hi</b>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
  });

  it('drops javascript:, data: and other unsafe link schemes but keeps the text', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>x</script>',
      'vbscript:x',
      '//evil.example',
    ]) {
      const html = markdownToHtml(`[click me](${url})`);
      expect(html).not.toMatch(/href=/);
      expect(html.toLowerCase()).not.toContain('javascript:');
      expect(html).toContain('click me');
    }
  });

  it('allows http, https and mailto links', () => {
    expect(markdownToHtml('[a](http://a.example)')).toContain('href="http://a.example/"');
    expect(markdownToHtml('[b](mailto:grants@halcyon-ridge.example)')).toContain(
      'href="mailto:grants@halcyon-ridge.example"',
    );
  });

  it('escapes quotes inside link URLs so attributes cannot be broken out of', () => {
    const html = markdownToHtml('[x](https://a.example/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"\s*onmouseover=/);
  });

  it('keeps snake_case literal and supports backslash escapes', () => {
    expect(markdownToHtml('use my_var_name here')).toContain('my_var_name');
    expect(markdownToHtml('\\*not italic\\*')).toContain('*not italic*');
  });

  it('renders a plain-text version', () => {
    expect(markdownToText('Hi **there**\n\n- a\n- [b](https://b.example)')).toBe(
      'Hi there\n\n- a\n- b (https://b.example/)',
    );
  });

  it('safeUrl rejects dangerous schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(' https://ok.example ')).toBe('https://ok.example/');
  });
});

describe('merge fields', () => {
  it('replaces tokens and escapes HTML in values', () => {
    const out = renderMergeFields('Hi {{applicant.first_name}} from {{ organization.name }}!', {
      'applicant.first_name': '<b>Maya</b>',
      'organization.name': 'Eastside "Youth" & Music',
    });
    expect(out).toBe('Hi &lt;b&gt;Maya&lt;/b&gt; from Eastside &quot;Youth&quot; &amp; Music!');
  });

  it('blanks known fields without values and leaves unknown tokens visible', () => {
    expect(renderMergeFields('[{{applicant.last_name}}] {{not.a_field}}', {})).toBe('[] {{not.a_field}}');
  });

  it('exports the supported merge field list', () => {
    const keys = MERGE_FIELDS.map((f) => f.key);
    expect(keys).toContain('applicant.first_name');
    expect(keys).toContain('organization.name');
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('brand colors', () => {
  it('keeps link text readable on light and dark backgrounds even with a pale brand color', () => {
    const r = resolveBrand({ ...brand, primaryColor: '#ffe680' });
    expect(contrastRatio(parseHex(r.linkLight)!, parseHex('#ffffff')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseHex(r.linkDark)!, parseHex('#1c1c1f')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseHex(r.buttonText)!, parseHex(r.buttonBg)!)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the heading font safe fallbacks', () => {
    expect(resolveBrand(brand).headingFontStack).toContain('Georgia');
    expect(resolveBrand({ ...brand, headingFont: 'Inter' }).headingFontStack).toContain('Arial, sans-serif');
  });
});
