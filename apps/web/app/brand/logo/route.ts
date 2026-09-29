// SPDX-License-Identifier: AGPL-3.0-or-later
// GET /brand/logo — the tenant's logo (public, cached).
import { serveBrandAsset } from '../serve';

export async function GET(req: Request) {
  return serveBrandAsset(req, 'logo');
}
