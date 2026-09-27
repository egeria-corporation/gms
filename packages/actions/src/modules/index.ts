// SPDX-License-Identifier: AGPL-3.0-only
// Importing this module registers every action in the registry.
export * as adminExtra from './admin-extra';
export * as applications from './applications';
export * as awards from './awards';
export * as comms from './comms';
export * as forms from './forms';
export * as messages from './messages';
export * as opportunities from './opportunities';
export * as orgs from './orgs';
export * as payments from './payments';
export * as platform from './platform';
export * as postaward from './postaward';
export * as review from './review';
export * as tenancy from './tenancy';
export { resolveSegment } from './comms';
export { validateApplication } from './applications';
export { agreementAttestation, agreementProps } from './awards';
export { syncAccounts } from './payments';
export { WEBHOOK_EVENTS } from './platform';
