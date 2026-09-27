// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-04: optional model-provider key for built-in assistants (R3 + step-up). The key is never shown back.
import {
  Alert,
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  ToneChip,
} from '@gms/ui';
import { CircleCheck, KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setModelKeyAction } from '@/app/console/(app)/settings/agents/actions';
import { useStepUp } from '@/components/console/step-up';

const PROVIDERS = { anthropic: 'Anthropic', openai: 'OpenAI-compatible' } as const;
type Provider = keyof typeof PROVIDERS | 'none';

export function ModelKeyForm({
  savedProvider,
  hasKey,
  canEdit,
}: {
  savedProvider: string | null;
  hasKey: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withStepUp, dialog } = useStepUp({ actionLabel: 'Save model key' });
  const [provider, setProvider] = useState<Provider>(
    savedProvider === 'anthropic' || savedProvider === 'openai' ? savedProvider : 'none',
  );
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const savedLabel =
    savedProvider && savedProvider in PROVIDERS
      ? PROVIDERS[savedProvider as keyof typeof PROVIDERS]
      : savedProvider;

  return (
    <>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (provider !== 'none' && key.trim().length < 10) {
            setKeyError('Paste the full API key (at least 10 characters).');
            return;
          }
          setKeyError(null);
          start(async () => {
            const r = await withStepUp(() =>
              setModelKeyAction(provider === 'none' ? { provider: null } : { provider, apiKey: key.trim() }),
            );
            if (r.ok) {
              setKey('');
              toast.success(provider === 'none' ? 'Model key removed.' : 'Model key saved.');
              router.refresh();
            } else setError(r.problem.detail);
          });
        }}
      >
        {hasKey ? (
          <ToneChip
            tone="success"
            icon={CircleCheck}
            label={`A key is saved (${savedLabel ?? 'provider'})`}
          />
        ) : (
          <ToneChip tone="muted" icon={KeyRound} label="No key saved — built-in assistants are off" />
        )}
        {error ? (
          <Alert variant="danger" title="The key wasn’t saved">
            {error}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <Field label="Provider" htmlFor="llm-provider">
            <Select value={provider} onValueChange={(v) => setProvider(v as Provider)} disabled={!canEdit}>
              <SelectTrigger id="llm-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai">OpenAI-compatible</SelectItem>
                <SelectItem value="none">None (remove key)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {provider !== 'none' ? (
            <Field
              label="API key"
              htmlFor="llm-key"
              error={keyError}
              description={
                hasKey
                  ? 'Saving replaces the current key.'
                  : 'Stored in the secret store. GMS never shows it again.'
              }
            >
              <Input
                id="llm-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                disabled={!canEdit}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
        {canEdit ? (
          <Button
            type="submit"
            variant="secondary"
            className="justify-self-start"
            pending={pending}
            pendingLabel="Saving…"
          >
            {provider === 'none' ? 'Remove model key' : 'Save model key'}
          </Button>
        ) : null}
      </form>
      {dialog}
    </>
  );
}
