// SPDX-License-Identifier: AGPL-3.0-or-later
// A-07 "For AI agents" page.
import { SCOPES } from '@gms/domain';
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { agentPolicy } from '@/lib/public-data';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'For AI agents' };

const POLICY_TEXT = {
  allowed: 'Applicants may use AI tools to help prepare applications.',
  disclosure: 'Applicants may use AI tools, but must tell us how in the AI-assistance question on each application.',
  prohibited: 'Applicants should not use AI tools to write application content.',
} as const;

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm break-all">{children}</code>;
}

export default async function ForAgentsPage() {
  const tenant = await requireTenant();
  const policy = await agentPolicy(tenant.id);
  const o = tenant.origin;
  return (
    <div className="grid max-w-4xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        title="For AI agents"
        description={`${tenant.brand.displayName} welcomes AI assistants that help people find and apply for grants. Here is how to connect, and the rules that keep people in charge.`}
      />
      <Alert variant="info" title="People always confirm the important steps">
        An agent can search, check eligibility, draft answers and upload files. Submitting an application or report, sending messages in bulk, and similar steps create a request that the person confirms inside {tenant.brand.displayName}’s site. Approving payments, recording final decisions, signing agreements and changing bank details can only be done by people.
      </Alert>
      <section className="grid gap-4 md:grid-cols-2" aria-label="Connection points">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              MCP server
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Code>{`${o}/mcp`}</Code>
            <p>Streamable HTTP, stateless. Public tools work without a token; everything else uses OAuth 2.1 or a personal access token.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              A2A agent
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Code>{`${o}/.well-known/agent-card.json`}</Code>
            <p>Ask questions about our opportunities, check eligibility, and follow an application’s status.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              REST API
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Code>{`${o}/api/v1/openapi.json`}</Code>
            <p>OpenAPI 3.1, plus Arazzo workflows for applying and reporting.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              CommonGrants
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Code>{`${o}/common-grants/opportunities`}</Code>
            <p>Our opportunities in the open CommonGrants format.</p>
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-3" aria-labelledby="connect-h">
        <h2 id="connect-h" className="font-heading text-xl font-semibold">
          Connecting for a person
        </h2>
        <ol className="grid list-decimal gap-2 pl-5">
          <li>
            Discover the authorization server from <Code>{`${o}/.well-known/oauth-protected-resource`}</Code>.
          </li>
          <li>Register (client ID metadata document preferred; dynamic registration also works).</li>
          <li>Send the person to authorize with PKCE and the resource you need. They choose which permissions to grant and for how long.</li>
          <li>
            Or: the person creates a personal access token under <Link className="text-link underline" href="/portal/account/agents">Connected agents</Link>.
          </li>
        </ol>
        <p>
          The full guide is at <Link className="text-link underline" href="/agents.md">/agents.md</Link>; a plain-text summary is at{' '}
          <Link className="text-link underline" href="/llms.txt">/llms.txt</Link>.
        </p>
      </section>
      <section className="grid gap-3" aria-labelledby="policy-h">
        <h2 id="policy-h" className="font-heading text-xl font-semibold">
          Our AI-use policy
        </h2>
        <p>{POLICY_TEXT[(policy?.ai_use ?? 'disclosure') as keyof typeof POLICY_TEXT]}</p>
        {policy && !policy.agent_submissions_enabled ? <Alert variant="warning" title="Agent submissions are paused">We are not accepting submissions made through AI agents right now.</Alert> : null}
      </section>
      <section className="grid gap-3" aria-labelledby="scopes-h">
        <h2 id="scopes-h" className="font-heading text-xl font-semibold">
          Permissions
        </h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table containerLabel="Permissions an agent can ask for">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Scope</TableHead>
                <TableHead scope="col">What it allows</TableHead>
                <TableHead scope="col">For</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(SCOPES).map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell>
                    <Code>{k}</Code>
                  </TableCell>
                  <TableCell>{v.label}</TableCell>
                  <TableCell className="capitalize">{v.audience}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
