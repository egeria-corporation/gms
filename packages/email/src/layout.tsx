// SPDX-License-Identifier: AGPL-3.0-or-later
// Table-based, inline-styled email layout. 600px max width, light + dark safe, no images except the optional logo.

import type { CSSProperties, ReactNode } from 'react';
import type { Block, EmailContent, Inline, Rich } from './blocks';
import { PALETTE, type ResolvedBrand } from './brand';
import { hrefOrHash } from './escape';
import { markdownToHtml } from './markdown';

const TABLE_RESET = { border: 0, cellPadding: 0, cellSpacing: 0, role: 'presentation' } as const;
/** Legacy `bgcolor` attribute (Outlook) — not in React's td typings. */
const bgcolor = (color: string) => ({ bgcolor: color }) as Record<string, string>;

function darkModeCss(b: ResolvedBrand): string {
  // Brand-derived values are normalized hex strings from resolveBrand, so interpolation is safe.
  return `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table { border-collapse: collapse; }
a { text-decoration: underline; }
@media (max-width: 620px) {
  .gms-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .gms-detail-label, .gms-detail-value { display: block !important; width: 100% !important; }
  .gms-detail-label { padding-bottom: 0 !important; }
}
@media (prefers-color-scheme: dark) {
  .gms-bg { background-color: ${PALETTE.darkPageBg} !important; }
  .gms-card { background-color: ${PALETTE.darkCardBg} !important; border-color: ${PALETTE.darkBorder} !important; }
  .gms-text { color: ${PALETTE.darkText} !important; }
  .gms-muted { color: ${PALETTE.darkMuted} !important; }
  .gms-link { color: ${b.linkDark} !important; }
  .gms-subtle { background-color: ${PALETTE.darkSubtle} !important; }
  .gms-rule { border-color: ${PALETTE.darkBorder} !important; }
}
[data-ogsc] .gms-text { color: ${PALETTE.darkText} !important; }
[data-ogsc] .gms-muted { color: ${PALETTE.darkMuted} !important; }
[data-ogsc] .gms-link { color: ${b.linkDark} !important; }
[data-ogsb] .gms-bg { background-color: ${PALETTE.darkPageBg} !important; }
[data-ogsb] .gms-card { background-color: ${PALETTE.darkCardBg} !important; }
[data-ogsb] .gms-subtle { background-color: ${PALETTE.darkSubtle} !important; }
`.trim();
}

interface Ctx {
  brand: ResolvedBrand;
}

function textStyle(b: ResolvedBrand, extra: CSSProperties = {}): CSSProperties {
  return {
    margin: '0 0 16px 0',
    fontFamily: b.bodyFontStack,
    fontSize: 16,
    lineHeight: '26px',
    color: PALETTE.text,
    ...extra,
  };
}

function Link({ href, children, brand }: { href: string; children: ReactNode; brand: ResolvedBrand }) {
  return (
    <a
      href={hrefOrHash(href)}
      className="gms-link"
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: brand.linkLight, textDecoration: 'underline' }}
    >
      {children}
    </a>
  );
}

function RichText({ value, brand }: { value: Rich; brand: ResolvedBrand }) {
  if (typeof value === 'string') return <>{value}</>;
  return (
    <>
      {value.map((part: Inline, i) => {
        if (typeof part === 'string') return <span key={i}>{part}</span>;
        if ('href' in part)
          return (
            <Link key={i} href={part.href} brand={brand}>
              {part.text}
            </Link>
          );
        return <strong key={i}>{part.text}</strong>;
      })}
    </>
  );
}

const TONE_BORDER = { success: '#15803d', warning: '#b45309' } as const;

function BlockView({ block, ctx }: { block: Block; ctx: Ctx }) {
  const b = ctx.brand;
  switch (block.type) {
    case 'heading':
      return (
        <h1
          className="gms-text"
          style={{
            margin: '0 0 16px 0',
            fontFamily: b.headingFontStack,
            fontSize: 24,
            lineHeight: '32px',
            fontWeight: 700,
            color: PALETTE.text,
          }}
        >
          {block.text}
        </h1>
      );
    case 'paragraph':
      return (
        <p className="gms-text" style={textStyle(b)}>
          <RichText value={block.content} brand={b} />
        </p>
      );
    case 'button': {
      const href = hrefOrHash(block.href);
      return (
        <>
          <table {...TABLE_RESET} style={{ margin: '8px 0 12px 0' }}>
            <tbody>
              <tr>
                <td
                  align="center"
                  {...bgcolor(b.buttonBg)}
                  style={{ borderRadius: 8, backgroundColor: b.buttonBg }}
                >
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      padding: '14px 28px',
                      fontFamily: b.bodyFontStack,
                      fontSize: 16,
                      lineHeight: '20px',
                      fontWeight: 700,
                      color: b.buttonText,
                      textDecoration: 'none',
                      borderRadius: 8,
                      border: `1px solid ${b.buttonBg}`,
                    }}
                  >
                    {block.label}
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
          <p
            className="gms-muted"
            style={textStyle(b, {
              fontSize: 13,
              lineHeight: '20px',
              color: PALETTE.muted,
              margin: '0 0 20px 0',
              wordBreak: 'break-all',
            })}
          >
            If the button doesn&apos;t work, copy this link into your browser:{' '}
            <Link href={href} brand={b}>
              {href}
            </Link>
          </p>
        </>
      );
    }
    case 'details':
      return (
        <table
          {...TABLE_RESET}
          width="100%"
          className="gms-subtle"
          style={{ margin: '0 0 20px 0', backgroundColor: PALETTE.subtle, borderRadius: 8 }}
        >
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                <td
                  className="gms-muted gms-detail-label"
                  valign="top"
                  width="40%"
                  style={{
                    padding: i === 0 ? '14px 12px 6px 16px' : '6px 12px 6px 16px',
                    fontFamily: b.bodyFontStack,
                    fontSize: 14,
                    lineHeight: '20px',
                    color: PALETTE.muted,
                    ...(i === block.rows.length - 1 ? { paddingBottom: 14 } : {}),
                  }}
                >
                  {row.label}
                </td>
                <td
                  className="gms-text gms-detail-value"
                  valign="top"
                  style={{
                    padding: i === 0 ? '14px 16px 6px 0' : '6px 16px 6px 0',
                    fontFamily: b.bodyFontStack,
                    fontSize: 14,
                    lineHeight: '20px',
                    fontWeight: 600,
                    color: PALETTE.text,
                    fontVariantNumeric: 'tabular-nums',
                    ...(i === block.rows.length - 1 ? { paddingBottom: 14 } : {}),
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'callout': {
      const border = block.tone === 'info' ? b.accent : TONE_BORDER[block.tone];
      return (
        <table {...TABLE_RESET} width="100%" style={{ margin: '0 0 20px 0' }}>
          <tbody>
            <tr>
              <td
                className="gms-subtle"
                style={{
                  borderLeft: `4px solid ${border}`,
                  backgroundColor: PALETTE.subtle,
                  padding: '14px 16px',
                  borderRadius: 4,
                }}
              >
                {block.title ? (
                  <p
                    className="gms-text"
                    style={textStyle(b, {
                      margin: '0 0 4px 0',
                      fontWeight: 700,
                      fontSize: 15,
                      lineHeight: '22px',
                    })}
                  >
                    {block.title}
                  </p>
                ) : null}
                <p className="gms-text" style={textStyle(b, { margin: 0, fontSize: 15, lineHeight: '22px' })}>
                  <RichText value={block.content} brand={b} />
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      );
    }
    case 'list': {
      const items = block.items.map((it, i) => (
        <li key={i} className="gms-text" style={textStyle(b, { margin: '0 0 8px 0' })}>
          <RichText value={it} brand={b} />
        </li>
      ));
      const listStyle: CSSProperties = { margin: '0 0 20px 0', padding: '0 0 0 24px', color: PALETTE.text };
      return (
        <>
          {block.title ? (
            <h2
              className="gms-text"
              style={{
                margin: '8px 0 8px 0',
                fontFamily: b.headingFontStack,
                fontSize: 18,
                lineHeight: '26px',
                fontWeight: 700,
                color: PALETTE.text,
              }}
            >
              {block.title}
            </h2>
          ) : null}
          {block.ordered ? (
            <ol className="gms-text" style={listStyle}>
              {items}
            </ol>
          ) : (
            <ul className="gms-text" style={listStyle}>
              {items}
            </ul>
          )}
        </>
      );
    }
    case 'quote':
      return (
        <table {...TABLE_RESET} width="100%" style={{ margin: '0 0 20px 0' }}>
          <tbody>
            <tr>
              <td
                className="gms-subtle"
                style={{
                  borderLeft: `4px solid ${b.accent}`,
                  backgroundColor: PALETTE.subtle,
                  padding: '14px 16px',
                }}
              >
                <p
                  className="gms-muted"
                  style={textStyle(b, {
                    margin: '0 0 6px 0',
                    fontSize: 13,
                    lineHeight: '18px',
                    color: PALETTE.muted,
                  })}
                >
                  {block.attribution}
                </p>
                <p className="gms-text" style={textStyle(b, { margin: 0, whiteSpace: 'pre-line' })}>
                  {block.text}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      );
    case 'markdown':
      return (
        <div
          dangerouslySetInnerHTML={{
            // markdownToHtml escapes all text and only emits p/ul/ol/li/strong/em/a(http|https|mailto).
            __html: markdownToHtml(block.source, {
              linkColor: b.linkLight,
              linkClass: 'gms-link',
              textColor: PALETTE.text,
              textClass: 'gms-text',
              fontFamily: b.bodyFontStack,
            }),
          }}
        />
      );
    case 'fineprint':
      return (
        <p
          className="gms-muted"
          style={textStyle(b, { fontSize: 13, lineHeight: '20px', color: PALETTE.muted })}
        >
          <RichText value={block.content} brand={b} />
        </p>
      );
  }
}

function Header({ brand }: { brand: ResolvedBrand }) {
  return (
    <tr>
      <td className="gms-pad" style={{ padding: '24px 32px 16px 32px' }}>
        {brand.logoUrl ? (
          // The logo sits on its own light chip so transparent dark logos stay visible in dark mode.
          <table {...TABLE_RESET}>
            <tbody>
              <tr>
                <td
                  {...bgcolor('#ffffff')}
                  style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 8 }}
                >
                  <img
                    src={brand.logoUrl}
                    alt={brand.displayName}
                    height={40}
                    style={{
                      display: 'block',
                      height: 40,
                      width: 'auto',
                      maxWidth: 220,
                      border: 0,
                      outline: 'none',
                      color: '#18181b',
                      fontFamily: brand.headingFontStack,
                      fontSize: 18,
                      fontWeight: 700,
                    }}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p
            className="gms-text"
            style={{
              margin: 0,
              fontFamily: brand.headingFontStack,
              fontSize: 20,
              lineHeight: '28px',
              fontWeight: 700,
              color: PALETTE.text,
            }}
          >
            {brand.displayName}
          </p>
        )}
      </td>
    </tr>
  );
}

function Footer({ brand, reason }: { brand: ResolvedBrand; reason: string }) {
  const small: CSSProperties = {
    margin: '0 0 8px 0',
    fontFamily: brand.bodyFontStack,
    fontSize: 12,
    lineHeight: '18px',
    color: PALETTE.muted,
  };
  return (
    <tr>
      <td className="gms-pad" style={{ padding: '20px 32px 32px 32px' }}>
        <p className="gms-muted" style={{ ...small, fontWeight: 700 }}>
          {brand.displayName}
        </p>
        <p className="gms-muted" style={small}>
          You&apos;re getting this email because {reason}
        </p>
        {brand.replyTo ? (
          <p className="gms-muted" style={small}>
            Questions? Reply to this email or write to{' '}
            <Link href={`mailto:${brand.replyTo}`} brand={brand}>
              {brand.replyTo}
            </Link>
            .
          </p>
        ) : null}
        {/* Required on every email (AGPL §13 source offer). Not configurable. */}
        <p className="gms-muted" style={{ ...small, margin: '12px 0 0 0' }}>
          Powered by GMS ·{' '}
          <Link href={brand.sourceUrl} brand={brand}>
            Source code
          </Link>
        </p>
      </td>
    </tr>
  );
}

export function EmailDocument({ content, brand }: { content: EmailContent; brand: ResolvedBrand }) {
  const ctx: Ctx = { brand };
  return (
    <html lang="en" dir="ltr">
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
        <title>{content.subject}</title>
        <style dangerouslySetInnerHTML={{ __html: darkModeCss(brand) }} />
      </head>
      <body
        className="gms-bg"
        style={{ margin: 0, padding: 0, backgroundColor: PALETTE.pageBg, width: '100%' }}
      >
        {/* Preheader: shown in the inbox preview, hidden in the message body. */}
        <div
          style={{
            display: 'none',
            overflow: 'hidden',
            lineHeight: '1px',
            opacity: 0,
            maxHeight: 0,
            maxWidth: 0,
            fontSize: 1,
            color: PALETTE.pageBg,
          }}
        >
          {content.preheader}
          {' ‌'.repeat(80)}
        </div>
        <table
          {...TABLE_RESET}
          width="100%"
          className="gms-bg"
          bgcolor={PALETTE.pageBg}
          style={{ backgroundColor: PALETTE.pageBg }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 12px' }}>
                <table {...TABLE_RESET} width="100%" style={{ maxWidth: 600, width: '100%' }}>
                  <tbody>
                    <tr>
                      <td
                        className="gms-card"
                        {...bgcolor(PALETTE.cardBg)}
                        style={{
                          backgroundColor: PALETTE.cardBg,
                          border: `1px solid ${PALETTE.border}`,
                          borderTop: `4px solid ${brand.primary}`,
                          borderRadius: 12,
                        }}
                      >
                        <table {...TABLE_RESET} width="100%">
                          <tbody>
                            <Header brand={brand} />
                            <tr>
                              <td className="gms-pad" style={{ padding: '8px 32px 16px 32px' }}>
                                {content.blocks.map((block, i) => (
                                  <BlockView key={i} block={block} ctx={ctx} />
                                ))}
                              </td>
                            </tr>
                            <tr>
                              <td className="gms-pad" style={{ padding: '0 32px' }}>
                                <hr
                                  className="gms-rule"
                                  style={{ border: 0, borderTop: `1px solid ${PALETTE.border}`, margin: 0 }}
                                />
                              </td>
                            </tr>
                            <Footer brand={brand} reason={content.reason} />
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
