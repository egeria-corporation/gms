// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-04 editor tabs: Details, Eligibility, Stages & forms, Distribution. The tab is kept in the URL (`?tab=`)
// without a server round trip so a reload or shared link opens the same tab.
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@gms/ui';
import { useState } from 'react';
import { DetailsForm } from './details-form';
import { DistributionForm } from './distribution-form';
import { EligibilityEditor } from './eligibility-editor';
import { StagesEditor } from './stages-editor';
import type { Distribution, EligibilityRuleView, OpportunityDetails, PublishableForm, StageView, TaxonomyTerm } from './types';

export type EditorTab = 'details' | 'eligibility' | 'stages' | 'distribution';

export function OpportunityEditor(props: {
  opportunityId: string;
  initialTab: EditorTab;
  details: OpportunityDetails;
  programs: { id: string; name: string }[];
  terms: TaxonomyTerm[];
  rules: EligibilityRuleView[];
  stages: StageView[];
  forms: PublishableForm[];
  distribution: Distribution;
  timeZone: string;
  readOnly: boolean;
  forcedSaveError?: boolean;
}) {
  const [tab, setTab] = useState<EditorTab>(props.initialTab);
  const change = (v: string) => {
    setTab(v as EditorTab);
    try {
      const url = new URL(window.location.href);
      if (v === 'details') url.searchParams.delete('tab');
      else url.searchParams.set('tab', v);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // URL sync is a convenience only.
    }
  };
  const missingForms = props.stages.length === 0 || props.stages[0]!.forms.length === 0;
  return (
    <Tabs value={tab} onValueChange={change}>
      <TabsList aria-label="Opportunity sections">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="eligibility">
          Eligibility
          <Badge variant="neutral" className="ml-1">
            {props.rules.length}
            <span className="sr-only"> questions</span>
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="stages">
          Stages & forms
          {missingForms ? (
            <Badge variant="warning" className="ml-1">
              !<span className="sr-only"> The first stage has no form</span>
            </Badge>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="distribution">Distribution</TabsTrigger>
      </TabsList>
      <TabsContent value="details" className="pt-4">
        <DetailsForm opportunityId={props.opportunityId} initial={props.details} programs={props.programs} terms={props.terms} timeZone={props.timeZone} readOnly={props.readOnly} forcedSaveError={props.forcedSaveError} />
      </TabsContent>
      <TabsContent value="eligibility" className="pt-4">
        <EligibilityEditor opportunityId={props.opportunityId} initial={props.rules} readOnly={props.readOnly} />
      </TabsContent>
      <TabsContent value="stages" className="pt-4">
        <StagesEditor opportunityId={props.opportunityId} stages={props.stages} forms={props.forms} timeZone={props.timeZone} readOnly={props.readOnly} />
      </TabsContent>
      <TabsContent value="distribution" className="pt-4">
        <DistributionForm opportunityId={props.opportunityId} initial={props.distribution} visibility={props.details.visibility} readOnly={props.readOnly} />
      </TabsContent>
    </Tabs>
  );
}
