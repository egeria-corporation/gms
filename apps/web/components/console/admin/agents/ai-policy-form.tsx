// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-04: the foundation's AI-use policy for applicants, reviewer assistance, and agent kill switches.
import { Alert, Button, Field, FieldSet, RadioGroup, RadioOption, Switch, Textarea, toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { updateAiPolicyAction } from '@/app/console/(app)/settings/agents/actions';

export interface AiPolicy {
  aiUse: 'allowed' | 'disclosure' | 'prohibited';
  disclosurePrompt: string;
  reviewerAssist: boolean;
  agentSubmissionsEnabled: boolean;
  mcpEnabled: boolean;
  a2aEnabled: boolean;
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-d`} className="text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-d`}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

export function AiPolicyForm({ policy, canEdit }: { policy: AiPolicy; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [p, setP] = useState<AiPolicy>(policy);
  const [error, setError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const set = <K extends keyof AiPolicy>(k: K, v: AiPolicy[K]) => setP((cur) => ({ ...cur, [k]: v }));

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const prompt = p.disclosurePrompt.trim();
        if (p.aiUse === 'disclosure' && prompt.length < 10) {
          setPromptError('Write at least 10 characters so applicants know what to disclose.');
          return;
        }
        if (prompt && prompt.length < 10) {
          setPromptError('Write at least 10 characters, or leave it empty.');
          return;
        }
        setPromptError(null);
        setError(null);
        start(async () => {
          const r = await updateAiPolicyAction({
            aiUse: p.aiUse,
            ...(prompt ? { disclosurePrompt: prompt } : {}),
            reviewerAssist: p.reviewerAssist,
            agentSubmissionsEnabled: p.agentSubmissionsEnabled,
            mcpEnabled: p.mcpEnabled,
            a2aEnabled: p.a2aEnabled,
          });
          if (r.ok) {
            toast.success('AI-use policy saved.');
            router.refresh();
          } else {
            setError(r.problem.detail);
            const issue = r.problem.errors?.find((i) => i.pointer === '/disclosurePrompt');
            if (issue) setPromptError(issue.message);
          }
        });
      }}
    >
      {error ? (
        <Alert variant="danger" title="The policy wasn’t saved">
          {error}
        </Alert>
      ) : null}
      <fieldset disabled={!canEdit} className="grid gap-5 disabled:opacity-90">
        <FieldSet legend="Can applicants use AI to write their applications?">
          <RadioGroup
            value={p.aiUse}
            onValueChange={(v) => set('aiUse', v as AiPolicy['aiUse'])}
            disabled={!canEdit}
          >
            <RadioOption
              value="allowed"
              label="Allowed"
              description="Applicants can use AI tools and agents freely."
            />
            <RadioOption
              value="disclosure"
              label="Allowed with disclosure"
              description="Applicants answer the disclosure question below when they submit."
            />
            <RadioOption
              value="prohibited"
              label="Not allowed"
              description="Applications say AI tools aren’t allowed, and agent submissions are turned off."
            />
          </RadioGroup>
        </FieldSet>
        <Field
          label="Disclosure question"
          htmlFor="ai-disclosure"
          required={p.aiUse === 'disclosure'}
          error={promptError}
          description="Shown to applicants on the submit step. At least 10 characters."
        >
          <Textarea
            id="ai-disclosure"
            rows={3}
            maxLength={500}
            value={p.disclosurePrompt}
            onChange={(e) => set('disclosurePrompt', e.target.value)}
          />
        </Field>
        <div className="grid divide-y rounded-lg border px-4">
          <SwitchRow
            label="Reviewer assist"
            description="Reviewers can ask the built-in assistant to summarize an application. Scores stay theirs."
            checked={p.reviewerAssist}
            onChange={(v) => set('reviewerAssist', v)}
            disabled={!canEdit}
          />
          <SwitchRow
            label="Agent submissions"
            description="Applicants’ agents can ask to submit applications (the applicant always confirms). Turn off to stop them right away."
            checked={p.agentSubmissionsEnabled}
            onChange={(v) => set('agentSubmissionsEnabled', v)}
            disabled={!canEdit}
          />
          <SwitchRow
            label="MCP server"
            description="AI tools can connect over the Model Context Protocol. Turn off to disconnect every MCP client."
            checked={p.mcpEnabled}
            onChange={(v) => set('mcpEnabled', v)}
            disabled={!canEdit}
          />
          <SwitchRow
            label="A2A (agent-to-agent)"
            description="Other agents can send tasks to this workspace. Turn off to refuse every A2A request."
            checked={p.a2aEnabled}
            onChange={(v) => set('a2aEnabled', v)}
            disabled={!canEdit}
          />
        </div>
      </fieldset>
      {canEdit ? (
        <Button type="submit" className="justify-self-start" pending={pending} pendingLabel="Saving…">
          Save AI-use policy
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners and admins can change the policy.</p>
      )}
    </form>
  );
}
