// SPDX-License-Identifier: AGPL-3.0-or-later
// The GMS CommonGrants plugin: the custom fields GMS adds to CG models, and its custom search filters.
//
// `definePlugin` in @common-grants/sdk 0.8 only supports the Opportunity schema
// (`ExtensibleSchemaName = "Opportunity"`) and only `opportunities.search` filters, so the
// Opportunity extension is a real SDK plugin and the other models are described by
// `GMS_CUSTOM_FIELDS`, a plain JSON catalog with the same shape (name, fieldType, description).
import { definePlugin } from '@common-grants/sdk/extensions';
import { z } from 'zod';
import type { CgCustomFieldType } from './types';

const MoneyValue = z.object({ amount: z.string(), currency: z.string() });

export const gmsPlugin = definePlugin({
  meta: {
    name: 'gms',
    version: '0.1.0',
    sourceSystem: 'gms',
    capabilities: ['customFields', 'customFilters'],
  },
  schemas: {
    Opportunity: {
      customFields: {
        summary: { name: 'summary', fieldType: 'string', value: z.string(), description: 'Short summary of the opportunity.' },
        eligibilitySummary: { name: 'eligibilitySummary', fieldType: 'string', value: z.string(), description: 'Who can apply, in plain language (Markdown).' },
        causeAreas: { name: 'causeAreas', fieldType: 'array', value: z.array(z.string()), description: 'Cause area taxonomy codes the opportunity funds.' },
        geography: { name: 'geography', fieldType: 'array', value: z.array(z.string()), description: 'Geography taxonomy codes the opportunity serves.' },
        programName: { name: 'programName', fieldType: 'string', value: z.string(), description: 'The grantmaker program that runs this opportunity.' },
        applyUrl: { name: 'applyUrl', fieldType: 'string', value: z.url(), description: 'Where applicants start an application.' },
        decisionExpectedOn: {
          name: 'decisionExpectedOn',
          fieldType: 'string',
          value: z.iso.date(),
          description: 'Date (YYYY-MM-DD) decisions are expected.',
        },
      },
    },
  },
  routes: {
    opportunities: {
      search: {
        filters: {
          causeAreas: { filterType: 'stringArray', description: 'Opportunity funds any (in) / none (notIn) of these cause area codes.' },
          geography: { filterType: 'stringArray', description: 'Opportunity serves any (in) / none (notIn) of these geography codes.' },
        },
      },
    },
  },
} as const);

/** Zod schema for a GMS-extended Opportunity (base CG schema + typed GMS custom fields). */
export const GmsOpportunitySchema = gmsPlugin.schemas.Opportunity.commonSchema;

export interface CustomFieldCatalogEntry {
  fieldType: CgCustomFieldType;
  description: string;
  /** JSON Schema for `value` when it is not a plain scalar. */
  valueSchema?: Record<string, unknown>;
}

const money = { type: 'object', required: ['amount', 'currency'], properties: { amount: { type: 'string' }, currency: { type: 'string' } } };

/**
 * Every custom field GMS emits, per CG model. The Opportunity entries mirror `gmsPlugin`.
 * Published as-is in the OpenAPI document (`x-gms-custom-fields`) and in `typespec/gms.tsp`.
 */
export const GMS_CUSTOM_FIELDS = {
  Opportunity: {
    summary: { fieldType: 'string', description: 'Short summary of the opportunity.' },
    eligibilitySummary: { fieldType: 'string', description: 'Who can apply, in plain language (Markdown).' },
    causeAreas: { fieldType: 'array', description: 'Cause area taxonomy codes the opportunity funds.', valueSchema: { type: 'array', items: { type: 'string' } } },
    geography: { fieldType: 'array', description: 'Geography taxonomy codes the opportunity serves.', valueSchema: { type: 'array', items: { type: 'string' } } },
    programName: { fieldType: 'string', description: 'The grantmaker program that runs this opportunity.' },
    applyUrl: { fieldType: 'string', description: 'Where applicants start an application.' },
    decisionExpectedOn: { fieldType: 'string', description: 'Date (YYYY-MM-DD) decisions are expected.' },
  },
  Competition: {
    stageOrder: { fieldType: 'integer', description: 'Stage number within the opportunity (1 = first stage).' },
    access: { fieldType: 'string', description: '"public" (anyone may apply) or "invite" (invited applicants only).' },
    graceMinutes: { fieldType: 'integer', description: 'Minutes after the deadline during which submissions are still accepted.' },
  },
  Form: {
    formVersionId: { fieldType: 'string', description: 'The immutable published form version this document describes.' },
  },
  AppFormResponse: {
    formVersionId: { fieldType: 'string', description: 'The form version these answers were saved against.' },
    etag: { fieldType: 'string', description: 'Send as If-Match when saving to avoid overwriting newer answers.' },
  },
  Application: {
    referenceNumber: { fieldType: 'string', description: 'Human-readable reference number.' },
    applicationTitle: { fieldType: 'string', description: 'Title the applicant gave the application.' },
    requestedAmount: { fieldType: 'object', description: 'Amount requested (CG Money).', valueSchema: money },
    organizationId: { fieldType: 'string', description: 'Applicant organization id.' },
    aiDisclosure: { fieldType: 'string', description: 'Applicant-supplied disclosure of AI assistance.' },
  },
  Award: {
    referenceNumber: { fieldType: 'string', description: 'Grantmaker reference number.' },
    fiscalYear: { fieldType: 'integer', description: 'Fiscal year the award is booked in.' },
    programName: { fieldType: 'string', description: 'Program that made the award.' },
    recipientName: { fieldType: 'string', description: 'Recipient organization (public transparency data).' },
    recipientLocation: {
      fieldType: 'object',
      description: 'Recipient location (public transparency data).',
      valueSchema: { type: 'object', properties: { city: { type: 'string' }, county: { type: 'string' }, state: { type: 'string' } } },
    },
  },
  Organization: {
    orgType: { fieldType: 'string', description: 'GMS organization type (e.g. nonprofit_501c3, fiscally_sponsored).' },
    dbaName: { fieldType: 'string', description: '"Doing business as" name.' },
    annualBudget: { fieldType: 'object', description: 'Annual operating budget (CG Money).', valueSchema: money },
    counties: { fieldType: 'array', description: 'Counties served.', valueSchema: { type: 'array', items: { type: 'string' } } },
  },
} as const satisfies Record<string, Record<string, CustomFieldCatalogEntry>>;

export type GmsCustomFieldModel = keyof typeof GMS_CUSTOM_FIELDS;

/** Validates typed values of GMS custom fields that are not plain strings (used by tests and consumers). */
export const GMS_CUSTOM_FIELD_VALUE_SCHEMAS = {
  requestedAmount: MoneyValue,
  annualBudget: MoneyValue,
} as const;
