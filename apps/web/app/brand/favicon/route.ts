// SPDX-License-Identifier: AGPL-3.0-or-later
// GET /brand/favicon — the tenant's favicon (falls back to the logo; public, cached).
import { serveBrandAsset } from '../serve';

export async function GET(req: Request) {
  return serveBrandAsset(req, 'favicon');
}
