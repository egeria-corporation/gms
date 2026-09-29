// SPDX-License-Identifier: AGPL-3.0-or-later
// DS-02 Components.
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AreaChart,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  DeadlineChip,
  DescriptionList,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DonutChart,
  Field,
  FieldSet,
  Input,
  Label,
  LineChart,
  MoneyDisplay,
  Pagination,
  RadioGroup,
  RadioOption,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SimpleTooltip,
  StatTile,
  StatusChip,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  TooltipProvider,
  formatBytes,
  type TimelineEvent,
} from '@gms/ui';
import { formatMoneyShort } from '@gms/domain';
import { Download, Filter, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { NextLink } from '@/components/next-link';
import { CountyMapDemo, DataTableDemo, PaginationDemo, ToastDemo } from './component-demos';
import {
  APPLICATIONS_BY_MONTH,
  AWARDS_BY_QUARTER,
  DEMO_APPLICATIONS,
  DEMO_TZ,
  PAYMENTS_BY_MONTH,
  PORTFOLIO_MIX,
} from './fixtures';

const VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;
const SIZES = ['sm', 'default', 'lg'] as const;
const BADGES = [
  'default',
  'secondary',
  'outline',
  'success',
  'warning',
  'danger',
  'info',
  'progress',
  'neutral',
  'muted',
  'agent',
] as const;

function Demo({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Section level={3} id={id} title={title} description={description}>
      <div className="rounded-lg border bg-card p-5 text-card-foreground">{children}</div>
    </Section>
  );
}

const HOUR = 3_600_000;

export function ComponentsSection({ page }: { page: number }) {
  const now = new Date();
  const events: TimelineEvent[] = [
    {
      id: 'e1',
      actor: { type: 'human', name: 'Maya Chen' },
      action: 'submitted the application',
      at: new Date(now.getTime() - 50 * HOUR).toISOString(),
      tone: 'info',
    },
    {
      id: 'e2',
      actor: { type: 'agent', name: 'Intake Assistant', onBehalfOfName: 'Priya Natarajan' },
      action: 'drafted an eligibility summary',
      at: new Date(now.getTime() - 26 * HOUR).toISOString(),
      tone: 'agent',
    },
    {
      id: 'e3',
      actor: { type: 'human', name: 'Priya Natarajan' },
      action: (
        <>
          moved the application to <StatusChip kind="application" value="under_review" size="sm" />
        </>
      ),
      at: new Date(now.getTime() - 3 * HOUR).toISOString(),
      tone: 'progress',
    },
    {
      id: 'e4',
      actor: { type: 'system', name: 'GMS' },
      action: 'sent a deadline reminder to 3 reviewers',
      at: new Date(now.getTime() - 0.5 * HOUR).toISOString(),
      tone: 'muted',
    },
  ];

  return (
    <Section
      id="ds-02"
      title="DS-02 Components"
      description="Every @gms/ui building block with realistic, fictional content."
    >
      <TooltipProvider>
        <Demo
          title="Buttons"
          description="Six variants, three sizes, icon buttons (always with an accessible name), pending and disabled."
        >
          <div className="grid gap-4">
            {SIZES.map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-xs text-muted-foreground">{size}</span>
                {VARIANTS.map((v) => (
                  <Button key={v} variant={v} size={size}>
                    {v === 'destructive'
                      ? 'Delete draft'
                      : v === 'link'
                        ? 'View details'
                        : `Save ${v === 'default' ? 'branding' : 'draft'}`}
                  </Button>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs text-muted-foreground">states</span>
              <Button pending pendingLabel="Saving…">
                Save branding
              </Button>
              <Button variant="outline" pending>
                Send invite
              </Button>
              <Button disabled>Submit application</Button>
              <Button variant="secondary">
                <Plus aria-hidden="true" />
                New opportunity
              </Button>
              <SimpleTooltip content="Export as CSV">
                <Button variant="outline" size="icon" aria-label="Export as CSV">
                  <Download aria-hidden="true" />
                </Button>
              </SimpleTooltip>
              <SimpleTooltip content="Filter applications">
                <Button variant="ghost" size="icon-sm" aria-label="Filter applications">
                  <Filter aria-hidden="true" />
                </Button>
              </SimpleTooltip>
              <Button variant="destructive" size="icon" aria-label="Remove file">
                <Trash2 aria-hidden="true" />
              </Button>
              <Button asChild variant="link">
                <NextLink href="/dev/catalog">Open the screen catalog</NextLink>
              </Button>
            </div>
          </div>
        </Demo>

        <Demo
          title="Form controls"
          description="Field wires the label, description and error to the control. Errors are announced and never rely on color alone."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="grid content-start gap-4">
              <Field
                label="Organization name"
                htmlFor="ds-org"
                required
                description="As it appears on your IRS determination letter."
              >
                <Input
                  id="ds-org"
                  defaultValue="Eastside Youth Music Collective"
                  autoComplete="organization"
                />
              </Field>
              <Field label="EIN" htmlFor="ds-ein" required error="Enter a 9-digit EIN like 12-3456789.">
                <Input id="ds-ein" defaultValue="12-34" inputMode="numeric" />
              </Field>
              <Field label="Website" htmlFor="ds-web" optional>
                <Input id="ds-web" type="url" inputSize="lg" placeholder="https://" />
              </Field>
              <Field label="Program officer" htmlFor="ds-officer">
                <Select defaultValue="priya">
                  <SelectTrigger id="ds-officer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priya">Priya Natarajan</SelectItem>
                    <SelectItem value="daniel">Daniel Okafor</SelectItem>
                    <SelectItem value="helen">Helen Ortiz</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Fiscal year end" htmlFor="ds-fy" description="Locked after the first award.">
                <Input id="ds-fy" defaultValue="June 30" disabled inputSize="sm" />
              </Field>
            </div>
            <div className="grid content-start gap-4">
              <Field
                label="Project summary"
                htmlFor="ds-summary"
                required
                description="Plain language, up to 50 words."
              >
                <Textarea
                  id="ds-summary"
                  maxWords={50}
                  defaultValue="Free after-school violin and cello lessons for 60 middle schoolers in the Eastside neighborhood, taught by local musicians, with two community concerts each semester and instruments students can take home."
                />
              </Field>
              <FieldSet legend="Organization type" required error="Choose one option.">
                <RadioGroup defaultValue="">
                  <RadioOption value="501c3" label="501(c)(3) public charity" />
                  <RadioOption
                    value="sponsored"
                    label="Fiscally sponsored project"
                    description="We'll ask for your sponsor's details next."
                  />
                  <RadioOption value="gov" label="Government or tribal entity" />
                </RadioGroup>
              </FieldSet>
              <FieldSet legend="Notifications">
                <CheckboxField
                  label="Deadline reminders"
                  description="Seven days and one day before a deadline."
                  defaultChecked
                />
                <CheckboxField label="Messages from program staff" defaultChecked />
                <CheckboxField label="Monthly newsletter" disabled />
              </FieldSet>
              <div className="flex items-center gap-3">
                <Switch id="ds-switch" defaultChecked />
                <Label htmlFor="ds-switch">Show awarded grants on the public site</Label>
              </div>
            </div>
          </div>
        </Demo>

        <Demo title="Badges" description="Labels only. Statuses use StatusChip (icon + text + color).">
          <div className="flex flex-wrap gap-2">
            {BADGES.map((b) => (
              <Badge key={b} variant={b}>
                {b}
              </Badge>
            ))}
          </div>
        </Demo>

        <Demo title="Alerts">
          <div className="grid gap-3">
            <Alert variant="info" title="Applications open October 1">
              You can save a draft now and submit once the opportunity opens.
            </Alert>
            <Alert variant="success" title="Invite sent">
              Daniel Okafor will get an email with a link that works for 7 days.
            </Alert>
            <Alert
              variant="warning"
              title="Your 501(c)(3) letter expires in 12 days"
              actions={
                <Button size="sm" variant="outline">
                  Upload a new letter
                </Button>
              }
            >
              Applications you submit after it expires will be held for review.
            </Alert>
            <Alert variant="danger" title="Payment failed">
              Mercury returned the transfer to Riverbend Food Pantry. Check the payee&rsquo;s bank details,
              then retry.
            </Alert>
          </div>
        </Demo>

        <Demo
          title="Tabs"
          description="Underline tabs for page sections; pill tabs for compact switches inside a card."
        >
          <div className="grid gap-6">
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="answers">Answers</TabsTrigger>
                <TabsTrigger value="reviews">Reviews (3)</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="text-sm">
                After-School Strings Program · requesting $25,000 over 12 months.
              </TabsContent>
              <TabsContent value="answers" className="text-sm">
                Eleven answers across four pages.
              </TabsContent>
              <TabsContent value="reviews" className="text-sm">
                Three of four reviewers have submitted scores.
              </TabsContent>
              <TabsContent value="activity" className="text-sm">
                Last updated 3 hours ago.
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="month">
              <TabsList variant="pill">
                <TabsTrigger value="month">This month</TabsTrigger>
                <TabsTrigger value="quarter">Quarter</TabsTrigger>
                <TabsTrigger value="year">Year</TabsTrigger>
              </TabsList>
              <TabsContent value="month" className="text-sm">
                <MoneyDisplay cents={11_200_000} /> sent in September.
              </TabsContent>
              <TabsContent value="quarter" className="text-sm">
                <MoneyDisplay cents={28_350_000} /> sent this quarter.
              </TabsContent>
              <TabsContent value="year" className="text-sm">
                <MoneyDisplay cents={44_500_000} /> sent this year.
              </TabsContent>
            </Tabs>
          </div>
        </Demo>

        <Demo
          title="Overlays"
          description="Dialog, confirmation dialog, sheet and tooltip. Focus is trapped and returned; Escape closes."
        >
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Invite a teammate</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite a teammate</DialogTitle>
                  <DialogDescription>
                    They&rsquo;ll get an email with a sign-in link that works for 7 days.
                  </DialogDescription>
                </DialogHeader>
                <Field label="Email address" htmlFor="ds-invite-email" required>
                  <Input id="ds-invite-email" type="email" defaultValue="daniel@halcyon-ridge.example" />
                </Field>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button>Send invite</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Withdraw application</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Withdraw this application?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Halcyon Ridge Foundation will stop reviewing it. You can&rsquo;t undo this, but you can
                    apply again next cycle.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep application</AlertDialogCancel>
                  <AlertDialogAction>Withdraw application</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Filter applications</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Filter applications</SheetTitle>
                  <SheetDescription>Narrow the pipeline by status and county.</SheetDescription>
                </SheetHeader>
                <SheetBody className="grid content-start gap-3">
                  <FieldSet legend="County">
                    <CheckboxField label="Alder County" defaultChecked />
                    <CheckboxField label="Bramble County" />
                    <CheckboxField label="Cinder County" />
                  </FieldSet>
                </SheetBody>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button variant="outline">Clear</Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button>Show 12 applications</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <SimpleTooltip content="Reviewers can't see applicant contact details.">
              <Button variant="ghost">What reviewers see</Button>
            </SimpleTooltip>
          </div>
          <div className="mt-4">
            <ToastDemo />
          </div>
        </Demo>

        <Demo
          title="Table"
          description="Static table for small, fixed lists. Use DataTable for anything searchable or paged."
        >
          <Table containerLabel="Recent payments">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Payee</TableHead>
                <TableHead scope="col">Award</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="text-right">
                  Amount
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { payee: 'Riverbend Food Pantry', award: 'HRF-2027-009', status: 'sent', cents: 600_000 },
                {
                  payee: 'Cinder Hills Literacy Project',
                  award: 'HRF-2027-011',
                  status: 'awaiting_approval',
                  cents: 400_000,
                },
                { payee: 'Cedar Point Rowing Club', award: 'HRF-2027-012', status: 'failed', cents: 750_000 },
                {
                  payee: 'Eastside Youth Music Collective',
                  award: 'HRF-2027-014',
                  status: 'scheduled',
                  cents: 1_250_000,
                },
              ].map((r) => (
                <TableRow key={r.award}>
                  <TableCell className="font-medium">{r.payee}</TableCell>
                  <TableCell className="font-mono text-xs">{r.award}</TableCell>
                  <TableCell>
                    <StatusChip kind="payment" value={r.status} size="sm" />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyDisplay cents={r.cents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Demo>

        <Demo
          id="ds-02-pagination"
          title="Pagination"
          description="Numbered, never infinite scroll. Link mode works without JavaScript; button mode drives client state."
        >
          <div className="grid gap-4">
            <Pagination
              page={page}
              pageCount={13}
              total={312}
              pageSize={25}
              itemLabel="applications"
              getHref={(p) => `/dev/design-system?page=${p}#ds-02-pagination`}
              linkComponent={NextLink}
            />
            <PaginationDemo />
          </div>
        </Demo>

        <Demo
          title="DataTable (client mode)"
          description={`${DEMO_APPLICATIONS.length} fictional applications: search, sort, column chooser, density, row selection with a bulk action.`}
        >
          <DataTableDemo />
        </Demo>

        <Demo title="Stat tiles">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Open applications"
              value="142"
              delta={{ value: 12.4, label: 'vs. last cycle' }}
              sparkline={[88, 95, 101, 97, 120, 131, 142]}
            />
            <StatTile
              label="Awarded this year"
              value={<MoneyDisplay cents={221_750_000} short />}
              delta={{ value: 8.1, label: 'vs. last year' }}
            />
            <StatTile
              label="Overdue reports"
              value="4"
              delta={{ value: -33.3, goodWhen: 'down', label: 'vs. last month' }}
              footnote="2 are more than 30 days late."
            />
            <StatTile
              label="Median days to decision"
              value="41"
              delta={{ value: 0, goodWhen: 'neutral', label: 'no change' }}
              action={
                <a className="text-link underline-offset-4 hover:underline" href="#ds-02">
                  See pipeline
                </a>
              }
            />
          </div>
        </Demo>

        <Demo title="Description list" description="Rows for record summaries, grid for dense detail panels.">
          <div className="grid gap-6 lg:grid-cols-2">
            <DescriptionList
              items={[
                { term: 'Organization', detail: 'Eastside Youth Music Collective' },
                { term: 'EIN', detail: '12-3456789', numeric: true },
                { term: 'Requested', detail: <MoneyDisplay cents={2_500_000} />, numeric: true },
                { term: 'Fiscal sponsor', detail: null },
                { term: 'Status', detail: <StatusChip kind="application" value="under_review" /> },
              ]}
            />
            <DescriptionList
              layout="grid"
              columns={2}
              items={[
                { term: 'Award', detail: 'HRF-2027-014' },
                { term: 'Term', detail: 'Jan 1 – Dec 31, 2027' },
                { term: 'Program officer', detail: 'Priya Natarajan' },
                { term: 'Attachments', detail: `3 files · ${formatBytes(2_457_600)}` },
                {
                  term: 'Purpose',
                  detail: 'General support for the After-School Strings Program.',
                  wide: true,
                },
              ]}
            />
          </div>
        </Demo>

        <Demo
          title="Timeline"
          description="Who did what: a person, an agent acting for a person, or the system."
        >
          <Timeline events={events} timeZone={DEMO_TZ} now={now} />
        </Demo>

        <Demo
          title="Money & deadlines"
          description="Integer cents, tabular numerals. Deadlines show relative and exact time in the workspace timezone."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <ul className="grid gap-1.5 text-sm">
              <li>
                Default: <MoneyDisplay cents={2_500_000} />
              </li>
              <li>
                Compact: <MoneyDisplay cents={2_500_000} compact />
              </li>
              <li>
                Short: <MoneyDisplay cents={221_750_000} short />
              </li>
              <li>
                Other currency: <MoneyDisplay cents={1_800_000} currency="CAD" showCurrencyCode />
              </li>
              <li>
                Adjustment: <MoneyDisplay cents={-45_000} signColors /> /{' '}
                <MoneyDisplay cents={45_000} signColors showPlus />
              </li>
              <li>
                Missing: <MoneyDisplay cents={null} />
              </li>
            </ul>
            <ul className="grid content-start gap-2">
              <li>
                <DeadlineChip
                  at={new Date(now.getTime() + 12 * 24 * HOUR).toISOString()}
                  timeZone={DEMO_TZ}
                  now={now}
                />
              </li>
              <li>
                <DeadlineChip
                  at={new Date(now.getTime() + 30 * HOUR).toISOString()}
                  timeZone={DEMO_TZ}
                  now={now}
                  label="Closes"
                />
              </li>
              <li>
                <DeadlineChip
                  at={new Date(now.getTime() - 5 * HOUR).toISOString()}
                  timeZone={DEMO_TZ}
                  now={now}
                />
              </li>
              <li>
                <DeadlineChip
                  at={new Date(now.getTime() + 4 * 24 * HOUR).toISOString()}
                  timeZone={DEMO_TZ}
                  now={now}
                  size="sm"
                  hideExact
                  label="Report due"
                />
              </li>
            </ul>
          </div>
        </Demo>

        <Demo
          title="Charts"
          description="Each chart has a title, a one-line takeaway, and a data table fallback."
        >
          <div className="grid gap-8 lg:grid-cols-2">
            <BarChart
              title="Awards by quarter"
              description="Arts funding peaked in Q4."
              data={AWARDS_BY_QUARTER}
              categoryKey="quarter"
              categoryLabel="Quarter"
              series={[
                { key: 'arts', label: 'Arts & culture' },
                { key: 'youth', label: 'Youth development' },
                { key: 'health', label: 'Health' },
              ]}
              valueFormat="money"
            />
            <BarChart
              title="Awards by quarter (stacked)"
              description="Total awards grew each quarter except Q3."
              data={AWARDS_BY_QUARTER}
              categoryKey="quarter"
              categoryLabel="Quarter"
              series={[
                { key: 'arts', label: 'Arts & culture' },
                { key: 'youth', label: 'Youth development' },
                { key: 'health', label: 'Health' },
              ]}
              valueFormat="money"
              stacked
            />
            <LineChart
              title="Applications per month"
              description="Submissions more than doubled since April."
              data={APPLICATIONS_BY_MONTH}
              categoryKey="month"
              categoryLabel="Month"
              series={[
                { key: 'submitted', label: 'Submitted' },
                { key: 'awarded', label: 'Awarded' },
              ]}
            />
            <AreaChart
              title="Payments sent"
              description="September was the largest month so far."
              data={PAYMENTS_BY_MONTH}
              categoryKey="month"
              categoryLabel="Month"
              series={[{ key: 'sent', label: 'Sent' }]}
              valueFormat="money"
            />
            <DonutChart
              title="Portfolio by focus area"
              description="Arts and youth make up two thirds of giving."
              data={PORTFOLIO_MIX}
              nameKey="area"
              valueKey="amount"
              nameLabel="Focus area"
              valueLabel="Awarded"
              valueFormat="money"
              centerLabel={formatMoneyShort(PORTFOLIO_MIX.reduce((n, d) => n + Number(d.amount ?? 0), 0))}
            />
            <CountyMapDemo />
          </div>
        </Demo>

        <Card>
          <CardHeader>
            <CardTitle as="h3">Card</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Cards group related content. Every demo above sits on the same card surface.
          </CardContent>
        </Card>
      </TooltipProvider>
    </Section>
  );
}
