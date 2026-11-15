// SPDX-License-Identifier: AGPL-3.0-only
// `/embed/f/:handle/o/:slug` — the apply widget a funder puts on its own site in an iframe: the
// call, the funder, its deadline or status, a short eligibility summary, and Apply, which opens
// the public opportunity page in a new tab. No cookies, no sign-in; data comes from
// `GET /gms/public/embed/funders/{handle}/opportunities/{slug}` (published fields only).
import { useEffect, useRef, type CSSProperties } from "react";
import { useParams } from "react-router";
import { Calendar, CircleCheck, CircleMinus, Clock, ExternalLink, SearchX, ShieldOff } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { useApiQuery } from "../../api/hooks.ts";
import type { EmbedWidgetData } from "../../api/types.ts";
import { checkBrand, SYSTEM_BRAND } from "../../lib/contrast.ts";
import { postEmbedHeight } from "../../lib/embed.ts";
import { applicantTypeLabel, formatDate } from "../../lib/format.ts";
import { markOf, PoweredBy } from "./PublicFrame.tsx";

/** An address on this site as an absolute URL (the widget's links open outside the frame). */
const absolute = (href: string) => new URL(href, window.location.origin).toString();

function accentStyle(brand: EmbedWidgetData["funder"]["brand"]): CSSProperties {
  const { effective } = checkBrand(brand.accent ?? SYSTEM_BRAND.accent, brand.onAccent ?? SYSTEM_BRAND.onAccent);
  return { "--tenant": effective.accent, "--on-tenant": effective.onAccent } as CSSProperties;
}

/** Where the call stands, as icon and label. */
function EmbedStatus({ data }: { data: EmbedWidgetData }) {
  const o = data.opportunity;
  if (o.status === "closed") {
    return (
      <span className="bdg bdg-done">
        <CircleMinus className="ic" aria-hidden="true" />
        Closed
      </span>
    );
  }
  if (o.status === "forecasted") {
    return (
      <span className="bdg bdg-neutral">
        <Calendar className="ic" aria-hidden="true" />
        Forecasted
      </span>
    );
  }
  return data.acceptingApplications ? (
    <span className="bdg bdg-ok">
      <CircleCheck className="ic" aria-hidden="true" />
      Taking applications
    </span>
  ) : (
    <span className="bdg bdg-neutral">
      <Clock className="ic" aria-hidden="true" />
      Not taking applications yet
    </span>
  );
}

function dateLine(o: EmbedWidgetData["opportunity"]): string | null {
  if (o.status === "closed") return "No longer taking applications";
  if (o.status === "forecasted") return o.opensDate ? `Opens ${formatDate(o.opensDate)}` : "Opening date to be announced";
  return o.closeDate ? `${o.closeDate.name} ${formatDate(o.closeDate.date)}` : "No fixed deadline";
}

/** "Who can apply": the first rule labels, else the applicant types. */
function eligibilityLine(o: EmbedWidgetData["opportunity"]): string | null {
  if (o.eligibility.length) return `${o.eligibility.join(" · ")}${o.moreEligibility ? ` · and ${o.moreEligibility} more` : ""}`;
  if (o.acceptedApplicantTypes.length) return o.acceptedApplicantTypes.map(applicantTypeLabel).join(" · ");
  return null;
}

/** The card itself. The opportunity builder shows it as the embed preview. */
export function EmbedCard({ data, headingLevel = 1 }: { data: EmbedWidgetData; headingLevel?: 1 | 2 | 3 | 4 }) {
  const { funder, opportunity: o } = data;
  const Heading = `h${headingLevel}` as const;
  const page = absolute(data.links.page);
  const who = eligibilityLine(o);
  const when = dateLine(o);
  return (
    <article className="embed-card" style={accentStyle(funder.brand)} aria-label={`${o.title}, ${funder.name}`}>
      <div className="embed-funder">
        {funder.brand.logoUrl ? (
          <img src={funder.brand.logoUrl} alt="" />
        ) : (
          <span className="mark" aria-hidden="true">
            {markOf(funder.name)}
          </span>
        )}
        <span>{funder.name}</span>
      </div>
      {!funder.verified && (
        <div className="embed-meta">
          <ShieldOff className="ic ic-sm" aria-hidden="true" />
          <span>Organization not verified with OpenGrants Passport</span>
        </div>
      )}
      <Heading className="embed-title">{o.title}</Heading>
      <div className="embed-meta">
        <EmbedStatus data={data} />
        {when && <span>{when}</span>}
      </div>
      {who && (
        <p className="embed-elig">
          <span className="b">Who can apply:</span> {who}
        </p>
      )}
      <div className="embed-acts">
        {data.acceptingApplications ? (
          <a className="btn btn-tenant" href={page} target="_blank" rel="noopener" aria-label={`Apply to ${o.title} (opens in a new tab)`}>
            Apply
            <ExternalLink className="ic" aria-hidden="true" />
          </a>
        ) : (
          <a className="btn btn-secondary" href={page} target="_blank" rel="noopener" aria-label={`View details of ${o.title} (opens in a new tab)`}>
            View details
            <ExternalLink className="ic" aria-hidden="true" />
          </a>
        )}
      </div>
      {data.poweredBy && (
        <div className="embed-foot">
          <PoweredBy href={absolute("/")} newTab />
        </div>
      )}
    </article>
  );
}

export default function EmbedWidget() {
  const { handle = "", slug = "" } = useParams();
  const widget = useApiQuery((api) => api.publicEmbed(handle, slug), [handle, slug]);
  const root = useRef<HTMLElement>(null);

  // Tell the page that frames this widget how tall it is, so its resize script can fit the iframe.
  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return;
    const post = () => postEmbedHeight(window.parent, el.getBoundingClientRect().height);
    post();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(post);
    observer.observe(el);
    return () => observer.disconnect();
  }, [widget.status]);

  return (
    <main className="gms embed" ref={root}>
      {widget.status === "loading" && (
        <div className="embed-card" aria-busy="true">
          <span className="muted">Loading…</span>
        </div>
      )}
      {widget.status === "error" && (
        <div className="embed-card" role="status">
          <title>Opportunity not available</title>
          <div className="embed-meta">
            <SearchX className="ic" aria-hidden="true" />
            <span>{widget.error instanceof ApiError && widget.error.status === 404 ? "This opportunity is not available." : "This opportunity could not be loaded. Try again later."}</span>
          </div>
        </div>
      )}
      {widget.status === "ready" && (
        <>
          <title>{`${widget.data.opportunity.title} — ${widget.data.funder.name}`}</title>
          <EmbedCard data={widget.data} />
        </>
      )}
    </main>
  );
}
