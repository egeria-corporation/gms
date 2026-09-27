// SPDX-License-Identifier: AGPL-3.0-only
// Root host: the proxy rewrites /auth/* to /gms-root/auth/* on the root host, so the magic-link landing used by
// operator sign-in lives here too (same handler as tenant hosts).
export { GET } from '../../../auth/callback/route';
