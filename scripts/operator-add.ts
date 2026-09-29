// SPDX-License-Identifier: AGPL-3.0-or-later
// Makes a person a platform operator (root-host /operator console). Run on a machine with the production
// DATABASE_URL, e.g. once after the first deploy:
//
//   pnpm run operator:add --email you@example.org --name "Your Name"
//
// The operator then signs in at https://{root domain}/sign-in and enrolls TOTP (operators need aal2).
import { parseArgs } from 'node:util';
import { loadDotEnv } from '../packages/db/src/env';

loadDotEnv();
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { email: { type: 'string' }, name: { type: 'string' }, support: { type: 'boolean', default: false } },
});
if (!values.email || !values.name) {
  console.error('Usage: pnpm run operator:add --email <email> --name "<full name>" [--support]');
  process.exit(1);
}
const { getRuntime, systemContext } = await import('@gms/actions');
const rt = getRuntime();
const out = await rt.executor.run<{ userId: string; created: boolean }>(
  'operators.add',
  { email: values.email, fullName: values.name, role: values.support ? 'support' : 'operator' },
  systemContext(null),
);
console.log(`[operator:add] ${values.email} is ${out.created ? 'now' : 'still'} a platform ${values.support ? 'support user' : 'operator'} (${out.userId}).`);
await rt.db.destroy();
