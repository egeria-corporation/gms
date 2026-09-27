// SPDX-License-Identifier: AGPL-3.0-only
// `pnpm run setup`: non-interactive first-run setup (the CLI twin of the /setup wizard). Runs the race-safe
// `setup.initialize` action as the system actor, prints the workspace URL, and emails (or, in test auth mode,
// prints) a sign-in link for the owner.
import { parseArgs } from 'node:util';
import { loadDotEnv } from '../packages/db/src/env';

const HELP = `Usage: pnpm run setup --slug <slug> --name <name> --owner-email <email> --owner-name <name> [options]

Creates a foundation workspace and its owner, then sends the owner a sign-in link.
By default it refuses to run when a workspace already exists (use --allow-existing to add another).

Required (flag or environment variable):
  --slug <slug>            Web address, e.g. juniper-valley            GMS_SETUP_SLUG
  --name <name>            Foundation name                              GMS_SETUP_NAME
  --owner-email <email>    Owner's email address                        GMS_SETUP_OWNER_EMAIL
  --owner-name <name>      Owner's full name                            GMS_SETUP_OWNER_NAME

Optional:
  --primary <#hex>         Primary brand color (default #1F4E79)        GMS_SETUP_PRIMARY
  --accent <#hex>          Accent brand color (default #C9822B)         GMS_SETUP_ACCENT
  --font <label>           Heading font: Inter | "Source Serif 4" |     GMS_SETUP_FONT
                           "Atkinson Hyperlegible" | Figtree
  --timezone <tz>          IANA time zone (default America/Los_Angeles) GMS_SETUP_TIMEZONE
  --sender-name <name>     Email sender name (default: foundation name) GMS_SETUP_SENDER_NAME
  --reply-to <email>       Reply-to address for outgoing email          GMS_SETUP_REPLY_TO
  --payments <choice>      fake | sandbox | manual | later (default)    GMS_SETUP_PAYMENTS
  --program <name>         Create a first program                       GMS_SETUP_PROGRAM
  --opportunity <title>    Create a draft opportunity (needs --program) GMS_SETUP_OPPORTUNITY
  --template <key>         Form template for the opportunity            GMS_SETUP_TEMPLATE
                           (default general_operating)
  --invite <email:role>    Invite a team member; repeatable             GMS_SETUP_INVITES (comma-separated)
                           roles: admin, program_officer, finance, reviewer, board, auditor
  --allow-existing         Create even if other workspaces exist        GMS_SETUP_ALLOW_EXISTING=true
  --no-email               Don't send the sign-in link (print how to sign in instead)
  -h, --help               Show this help

Examples:
  pnpm run setup --slug juniper-valley --name "Juniper Valley Community Fund" \\
    --owner-email rosa@juniperfund.example --owner-name "Rosa Delgado" --primary "#2F5D50"
  GMS_SETUP_SLUG=juniper-valley GMS_SETUP_NAME="Juniper Valley Community Fund" \\
    GMS_SETUP_OWNER_EMAIL=rosa@juniperfund.example GMS_SETUP_OWNER_NAME="Rosa Delgado" pnpm run setup
`;

function fail(message: string, code = 1): never {
  console.error(`[setup] ${message}`);
  process.exit(code);
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());
}

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      'owner-email': { type: 'string' },
      'owner-name': { type: 'string' },
      primary: { type: 'string' },
      accent: { type: 'string' },
      font: { type: 'string' },
      timezone: { type: 'string' },
      'sender-name': { type: 'string' },
      'reply-to': { type: 'string' },
      payments: { type: 'string' },
      program: { type: 'string' },
      opportunity: { type: 'string' },
      template: { type: 'string' },
      invite: { type: 'string', multiple: true },
      'allow-existing': { type: 'boolean' },
      'no-email': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
}
try {
  args = parse();
} catch (err) {
  fail(`${(err as Error).message}\nRun \`pnpm run setup --help\` for usage.`, 2);
}

if (args.values.help) {
  console.log(HELP);
  process.exit(0);
}

loadDotEnv();
const env = process.env;
const v = args.values;

const slug = (v.slug ?? env.GMS_SETUP_SLUG ?? '').trim().toLowerCase();
const name = (v.name ?? env.GMS_SETUP_NAME ?? '').trim();
const ownerEmail = (v['owner-email'] ?? env.GMS_SETUP_OWNER_EMAIL ?? '').trim().toLowerCase();
const ownerName = (v['owner-name'] ?? env.GMS_SETUP_OWNER_NAME ?? '').trim();
const missing = [
  ['--slug', slug],
  ['--name', name],
  ['--owner-email', ownerEmail],
  ['--owner-name', ownerName],
]
  .filter(([, val]) => !val)
  .map(([flag]) => flag);
if (missing.length) fail(`Missing ${missing.join(', ')}.\nRun \`pnpm run setup --help\` for usage.`, 2);

const programName = (v.program ?? env.GMS_SETUP_PROGRAM ?? '').trim();
const opportunityTitle = (v.opportunity ?? env.GMS_SETUP_OPPORTUNITY ?? '').trim();
if (opportunityTitle && !programName) fail('--opportunity needs --program (the opportunity belongs to a program).', 2);

const inviteSpecs = v.invite ?? (env.GMS_SETUP_INVITES ? env.GMS_SETUP_INVITES.split(',') : []);
const invites = inviteSpecs
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    const i = spec.lastIndexOf(':');
    if (i < 1) fail(`Invite "${spec}" should look like email:role, e.g. marcus@juniperfund.example:program_officer.`, 2);
    return { email: spec.slice(0, i).trim().toLowerCase(), role: spec.slice(i + 1).trim() };
  });

const input = {
  slug,
  name,
  ownerEmail,
  ownerName,
  ...(v.timezone ?? env.GMS_SETUP_TIMEZONE ? { timezone: (v.timezone ?? env.GMS_SETUP_TIMEZONE)!.trim() } : {}),
  ...(v.primary ?? env.GMS_SETUP_PRIMARY ? { primaryColor: (v.primary ?? env.GMS_SETUP_PRIMARY)!.trim() } : {}),
  ...(v.accent ?? env.GMS_SETUP_ACCENT ? { accentColor: (v.accent ?? env.GMS_SETUP_ACCENT)!.trim() } : {}),
  ...(v.font ?? env.GMS_SETUP_FONT ? { headingFont: (v.font ?? env.GMS_SETUP_FONT)!.trim() } : {}),
  ...(v['sender-name'] ?? env.GMS_SETUP_SENDER_NAME ? { emailSenderName: (v['sender-name'] ?? env.GMS_SETUP_SENDER_NAME)!.trim() } : {}),
  emailReplyTo: (v['reply-to'] ?? env.GMS_SETUP_REPLY_TO ?? '').trim() || null,
  allowExisting: Boolean(v['allow-existing']) || truthy(env.GMS_SETUP_ALLOW_EXISTING),
  program: programName ? { name: programName, causeArea: null } : null,
  opportunity: opportunityTitle ? { title: opportunityTitle, templateKey: (v.template ?? env.GMS_SETUP_TEMPLATE ?? 'general_operating').trim() } : null,
  invites,
  paymentsChoice: (v.payments ?? env.GMS_SETUP_PAYMENTS ?? 'later').trim(),
};

// Imported after .env is loaded: the runtime reads DATABASE_URL, GMS_AUTH_MODE, GMS_ROOT_DOMAIN, … on first use.
const { getRuntime, originFor, systemContext } = await import('../packages/actions/src/index');
const { isDomainError } = await import('../packages/domain/src/index');
const { closeDb } = await import('../packages/db/src/index');

let exitCode = 0;
try {
  const rt = getRuntime();
  const r = await rt.executor.execute<{ workspaceId: string; ownerId: string; slug: string; programId: string | null; opportunityId: string | null; invited: number }>(
    'setup.initialize',
    input,
    systemContext(null, 'worker'),
  );
  if (r.status !== 'ok') throw new Error('setup.initialize unexpectedly asked for an approval.');
  const out = r.output;
  const origin = originFor(out.slug);
  console.log(`[setup] Created "${name}" (${out.workspaceId})`);
  console.log(`[setup]   Public site: ${origin}`);
  console.log(`[setup]   Console:     ${origin}/console`);
  if (out.programId) console.log(`[setup]   First program created${out.opportunityId ? ', with a draft opportunity' : ''}.`);
  if (out.invited) console.log(`[setup]   ${out.invited} invitation(s) queued (sent by the worker).`);
  console.log(`[setup]   Payments: ${input.paymentsChoice} (connect after signing in: Payments → Bank).`);

  const auth = rt.adapters.auth;
  const redirectTo = `${origin}/console`;
  if (auth.name === 'test-auth' && auth.generateLink) {
    const link = await auth.generateLink(ownerEmail, redirectTo);
    console.log(`[setup] Test auth mode — sign in as ${ownerEmail} with this one-time link (15 minutes):`);
    console.log(link);
  } else if (v['no-email']) {
    console.log(`[setup] No email sent. ${ownerEmail} can request a sign-in link at ${origin}/portal/sign-in?next=/console`);
  } else {
    try {
      await auth.sendMagicLink({ email: ownerEmail, redirectTo, workspaceId: out.workspaceId, brandName: name });
      console.log(`[setup] Sign-in link emailed to ${ownerEmail}.`);
    } catch (err) {
      console.warn(`[setup] The workspace is ready, but the sign-in email failed: ${(err as Error).message}`);
      console.warn(`[setup] ${ownerEmail} can request a new link at ${origin}/portal/sign-in?next=/console`);
    }
  }
} catch (err) {
  exitCode = 1;
  if (isDomainError(err)) {
    console.error(`[setup] ${err.message}`);
    for (const issue of err.issues) console.error(`[setup]   ${issue.pointer || '/'}: ${issue.message}`);
    if (err.code === 'conflict' && !input.allowExisting && !err.issues.length) console.error('[setup] Pass --allow-existing to add another workspace.');
  } else if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown }).issues)) {
    // A nested action's input check (zod) inside setup.initialize.
    console.error('[setup] Some values are not valid:');
    for (const i of (err as { issues: { path: (string | number)[]; message: string }[] }).issues) console.error(`[setup]   /${i.path.join('/')}: ${i.message}`);
  } else {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[setup] Setup failed: ${msg}`);
    if (/ECONNREFUSED|connect/i.test(msg)) console.error('[setup] Is the database running? Try `pnpm db:up`.');
  }
} finally {
  await closeDb().catch(() => undefined);
}
process.exit(exitCode);
