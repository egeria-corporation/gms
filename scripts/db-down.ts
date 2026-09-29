// SPDX-License-Identifier: AGPL-3.0-or-later
import { stopEmbedded } from '../packages/db/src/embedded';
await stopEmbedded();
console.log('[db:down] embedded Postgres stopped');
