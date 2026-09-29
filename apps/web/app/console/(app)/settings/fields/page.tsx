// SPDX-License-Identifier: AGPL-3.0-or-later
// S-08 Custom fields & taxonomies (states: empty).
import { PageHeader, Section } from '@gms/ui';
import type { Metadata } from 'next';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { CustomFields, type CustomFieldRow } from '@/components/console/admin/fields/custom-fields';
import { Taxonomies, type TermKind, type TermRow } from '@/components/console/admin/fields/taxonomies';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Custom fields & taxonomies' };

const KINDS: readonly string[] = ['cause', 'geography', 'population'];

export default async function FieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tenant, viewer] = await Promise.all([
    requireTenant(),
    requireStaff(['owner', 'admin', 'program_officer', 'auditor']),
  ]);
  const forced = forcedState(await searchParams);
  const canEdit = viewer.role === 'owner' || viewer.role === 'admin';

  const d = await rls(async (trx) => {
    const [fields, terms] = await Promise.all([
      trx
        .selectFrom('custom_field_definitions')
        .select(['id', 'entity', 'key', 'label', 'field_type', 'options', 'required'])
        .where('workspace_id', '=', tenant.id)
        .orderBy('entity')
        .orderBy('label')
        .execute(),
      trx
        .selectFrom('taxonomy_terms')
        .select(['id', 'kind', 'code', 'label', 'parent_id'])
        .where('workspace_id', '=', tenant.id)
        .orderBy('kind')
        .orderBy('label')
        .execute(),
    ]);
    return { fields, terms };
  });

  const empty = forced === 'empty';
  const fields: CustomFieldRow[] = empty
    ? []
    : d.fields.map((f) => ({
        id: f.id,
        entity: f.entity,
        key: f.key,
        label: f.label,
        fieldType: f.field_type,
        options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : [],
        required: f.required,
      }));
  const terms: TermRow[] = empty
    ? []
    : d.terms
        .filter((t) => KINDS.includes(t.kind))
        .map((t) => ({
          id: t.id,
          kind: t.kind as TermKind,
          code: t.code,
          label: t.label,
          parentId: t.parent_id,
        }));

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Custom fields & taxonomies"
        description="Extra fields your foundation tracks, and the cause areas, geographies and populations you tag grants with."
      />
      <SettingsTabs current="/console/settings/fields" />
      {!canEdit ? (
        <p className="-mt-4 text-sm text-muted-foreground">
          You can view these. Owners and admins can change them.
        </p>
      ) : null}

      <Section
        title="Custom fields"
        description="Shown on the record, included in exports, and published in the CommonGrants API as customFields."
      >
        <CustomFields fields={fields} canEdit={canEdit} />
      </Section>

      <Section title="Taxonomies" description="Codes stay stable for reporting; labels can change any time.">
        <Taxonomies terms={terms} canEdit={canEdit} />
      </Section>
    </div>
  );
}
