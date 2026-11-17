# Send to the funder, and the guest reviewer loop

Two ways the GMS reaches people who are not on it yet:

- an applicant who wrote an outside application in the GMS hands it to a funder as a clean package;
- an external reviewer, invited to review one competition, gets a short welcome, and once they finish,
  one offer to run a review panel of their own.

## Send to the funder

On an outside application, **Send to the funder** opens a dialog that says what the package holds,
downloads it, or emails it.

### The package

- **PDF** (`GET /gms/outside-applications/{id}/package.pdf`), made with pdf-lib through `@gms/documents`:
  1. a cover: organization, funder, program, amount requested, the letter of inquiry and application
     deadlines (never the team's internal deadline), and the date of the latest change;
  2. every question with its latest answer, in order (letter of inquiry first, then the full
     application); an empty answer reads "No answer given.";
  3. the budget summary when the application has one: the ask by year and the total;
  4. the list of attached files.
- **ZIP** (`…/package.zip`): that PDF, the attached files under their original names (made unique:
  `Budget.pdf`, `Budget (2).pdf`), and `answers.txt` (the questions and answers as plain text, to paste
  into a portal). Entries are stored, not compressed; the same content gives the same bytes.

The files are only:

- the documents attached to this application, except the funder's own guidelines, the award letter,
  the submission receipt and the GMS's "as submitted" copy;
- the vault documents the person used for this application's required documents ("Use from vault").

No other vault document and no file of another application is ever included. A Passport locker
document has no copy in the GMS, so it is listed as not included. A file named like a bank or tax form
is left out too.

Every page ends with "Prepared with the OpenGrants Grant Management System, free for funders and
applicants · gms.opengrants.io", as do `answers.txt` and the email, unless the workspace's `poweredBy`
setting is off. An applicant admin switches it in the dialog (`PUT /gms/send-package/settings`); it is
the same `settings.poweredBy` a funder sets in Settings > Public page.

### Bank and identity numbers

Before anything is built, every answer goes through the importers' sensitive screen
(`packages/importers/src/sensitive.ts`, `sensitiveValue`): each run of nine or more digits (single
spaces or dashes allowed) is read as a cell whose header is the question's prompt. Nine digits are an
identity number or bank routing number unless the question asks for an EIN; ten to nineteen digits are
an account or card number unless the question asks for a phone number. Any match stops the package
(`422 sensitive_answer`) and names the question; the number itself is never returned or stored.
`GET …/package` lists the blocked questions so the dialog can say which to fix.

### Email

- A person only, a workspace admin or editor. An agent's or API client's token is refused
  (`403 approval_required`) and no MCP tool sends a package.
- The person types the funder contact's address and an optional message. **Preview the email**
  (`POST …/package/email/preview`) returns exactly what would be sent, with a `digest`; **Send**
  (`POST …/package/email`) needs that digest and refuses (`409 preview_changed`) when the email would
  differ in any way: answers, files, footer, address or message.
- From: the person's account name on the GMS's sending address (`"Ana Ruiz" <RESEND_FROM address>`);
  Reply-To: the person's sign-in address. Neither is typed.
- Attached: the package PDF and each file, not the ZIP (mail filters often hold ZIP files). At most
  20 MB of files per email (`PACKAGE_EMAIL_MAX_BYTES`); a larger package is downloaded instead.
- At most five emails per application per UTC day (`PACKAGE_EMAILS_PER_DAY`), held in Postgres:
  each send takes the first free `slot` of `package_sends` (migration 0040), unique per application
  and day. A failed send gives its place back.
- Each send is recorded with the recipient masked (`l…@northwind.example`), the PDF's SHA-256 and the
  number of files, and ledgered as `outside_application.package_sent`. No answer text or full address
  is stored.
- The email goes through `@gms/notify` and Resend only when the mailer passes attachments on
  (`sendsAttachments`); otherwise `503 mail_attachments_unavailable` and the dialog says to download
  and send it from the person's own email.

### Agents

`get_send_package` (MCP, `applications:read`) returns what `GET …/package` returns: the contents, any
blocked answer and the download paths. Downloads are reads, open to agents like the export.

## The guest reviewer loop

### Welcome

An external reviewer is invited per competition (`POST /gms/review-assignments/invite`). The link
opens `/invitations/accept`; someone new signs in with the emailed code and is asked for no workspace
or organization. Accepting as `external_reviewer` lands on `/review/welcome?ws=<funder>`:

- the funder, the competition, how many applications are assigned, the earliest due date;
- the conflict-of-interest note, linking to where the reviewer declares conflicts (and signs the
  funder's policy, once that exists);
- **Start reviewing**, to the reviewer portal.

`GET /gms/guest-review/welcome` serves it, for an external reviewer of that funder only (`403
insufficient_role` for staff, other reviewers and applicants; agents are refused).

### Done, and the offer

`/review/done?ws=<funder>` (`GET /gms/guest-review/done`) thanks the reviewer once every assigned
review is submitted (recusals aside). It shows, once, **Run a review panel for your own organization,
free**:

- **Set up my organization** opens funder setup's first step in place: the organization name and
  handle, filled in from the reviewer's email domain as a suggestion only (none for shared mail
  providers such as Gmail), created with the same `POST /gms/workspaces` as funder setup (its daily
  caps apply). The new workspace's admin then takes the second step of sign-in.
- **Not now** (or the close button) dismisses it for good, in every funder's workspace.
- It is not shown to someone who already admins or runs programs in a funder workspace, and no email
  follows it.
- `PANEL_OFFER_SHOWS = 1`: one showing per person.

The offer's events (`guest_reviewer.panel_offer_shown`, `_clicked`, `_dismissed`, `_created`) are the
GMS's own ledger events, with no workspace, so no funder reads them; the offer's state is read back
from them. Each counts once per person (`POST /gms/guest-review/offer`); `created` counts only for a
funder workspace the person admins, made in the last hour. To count them:

```sql
select event_type, count(*) from public.ledger_events
where event_type like 'guest_reviewer.panel_offer_%' group by 1 order by 1;
```
