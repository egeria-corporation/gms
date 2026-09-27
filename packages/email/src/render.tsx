// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@react-email/render';
import { blocksToText } from './blocks';
import { resolveBrand, type Brand } from './brand';
import { EmailDocument } from './layout';
import { templates, type TemplateKey, type TemplateProps } from './templates';
import type { EmailTemplate } from './templates/shared';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Renders a branded transactional email to subject + HTML + plain-text parts. */
export async function renderEmail<K extends TemplateKey>(
  template: K,
  props: TemplateProps<K>,
  brand: Brand,
): Promise<RenderedEmail> {
  const def = templates[template] as unknown as EmailTemplate<TemplateProps<K>> | undefined;
  if (!def) throw new Error(`Unknown email template: ${String(template)}`);
  const resolved = resolveBrand(brand);
  const content = def.build(props, { brand: resolved });
  // Subjects are a header: no line breaks, reasonable length.
  const subject = content.subject
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
  const html = await render(<EmailDocument content={{ ...content, subject }} brand={resolved} />);
  const text = blocksToText({ ...content, subject }, resolved);
  return { subject, html, text };
}
