// SPDX-License-Identifier: AGPL-3.0-only
// DS-03 Form renderer modes. The React renderer (@gms/forms/react) hasn't landed in this build yet, so each mode
// shows a labeled placeholder describing what will render there, driven by the real FORM_TEMPLATES metadata.
import { FORM_TEMPLATES, listFields } from '@gms/forms';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Section } from '@gms/ui';
import { Eye, FileText, Hammer, PencilLine, Printer, type LucideIcon } from 'lucide-react';

const MODES: { id: string; label: string; icon: LucideIcon; who: string; renders: string[] }[] = [
  {
    id: 'edit',
    label: 'Edit',
    icon: PencilLine,
    who: 'Applicants and collaborators filling in a form (B-06, B-11).',
    renders: [
      'One page at a time with a progress rail of page titles',
      'Autosave indicator, word counts and inline validation on blur',
      'Conditional questions appear and disappear as answers change',
      'A validation summary that links to each problem on submit',
    ],
  },
  {
    id: 'review',
    label: 'Review (read-only)',
    icon: Eye,
    who: 'Staff and reviewers reading a submission (C-06, R-05).',
    renders: [
      'Every visible answer as label + value; hidden branches are omitted',
      'Long text shown as applicant-supplied quotes in AI contexts',
      'Attachments listed with name, size and a download link',
      'Empty answers shown as “Not provided”',
    ],
  },
  {
    id: 'print',
    label: 'Print',
    icon: Printer,
    who: 'The application packet PDF and browser print (H-03).',
    renders: [
      'All pages in one flow with page titles as headings',
      'No interactive controls; checkboxes and choices rendered as text',
      'Page breaks between form pages; tables never split mid-row',
    ],
  },
  {
    id: 'builder',
    label: 'Builder preview',
    icon: Hammer,
    who: 'Staff previewing a draft in the form builder (FB-04).',
    renders: [
      'The applicant view with a “Preview” banner and fake submit',
      'Toggles for form flags so each conditional branch can be checked',
      'Lint warnings and CommonGrants mapping badges beside each question',
    ],
  },
];

export function FormsSection() {
  return (
    <Section
      id="ds-03"
      title="DS-03 Form renderer modes"
      description="One form model, four ways to render it."
    >
      <Alert variant="info" title="Renderer not in this build yet">
        The React renderer (<code>@gms/forms/react</code>) is still being built. Each mode below describes
        what will render there, using the real template metadata from <code>@gms/forms</code>.
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        {MODES.map((m) => (
          <Card key={m.id} className="border-dashed">
            <CardHeader>
              <CardTitle as="h3" className="flex items-center gap-2">
                <m.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {m.label} mode
                <Badge variant="outline">Placeholder</Badge>
              </CardTitle>
              <CardDescription>{m.who}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                {m.renders.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Section
        level={3}
        title="Templates each mode will render"
        description={`${FORM_TEMPLATES.length} starter templates ship with GMS.`}
      >
        <ul className="grid gap-3 md:grid-cols-2">
          {FORM_TEMPLATES.map((t) => (
            <li key={t.key}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle as="h4" className="flex flex-wrap items-center gap-2">
                    <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                    {t.name}
                    <Badge variant="secondary">
                      {t.kind === 'loi'
                        ? 'Letter of inquiry'
                        : t.kind === 'report'
                          ? 'Report'
                          : 'Application'}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{t.description}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <p className="text-muted-foreground">
                    {t.model.pages.length} {t.model.pages.length === 1 ? 'page' : 'pages'} ·{' '}
                    {listFields(t.model).length} questions · <code className="text-xs">{t.key}</code>
                  </p>
                  <ol className="grid list-decimal gap-0.5 pl-5">
                    {t.model.pages.map((p) => (
                      <li key={p.id}>{p.title}</li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
    </Section>
  );
}
