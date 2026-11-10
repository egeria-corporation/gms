-- Seed for local development and demos. Everything here is fictitious: organizations, people,
-- identifiers (EINs use the unassigned 00 prefix) and addresses on the reserved .example TLD.
-- Sign-in for these users goes through Supabase Auth magic links (Mailpit locally).
begin;

-- ------------------------------------------------------------------------------------ users
insert into auth.users (id, email, aud, role) values
  ('10000000-0000-4000-8000-000000000001', 'dana.ortiz@riverbendcf.example',       'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000002', 'marcus.lee@riverbendcf.example',       'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000003', 'priya.natarajan@riverbendcf.example',  'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000004', 'hollis.grant@northlakeuniv.example',   'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000005', 'grants@cascadecounty.example',         'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000006', 'giving@summitline.example',            'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000011', 'maria.santos@aldercreek.example',      'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000012', 'jamal.reed@aldercreek.example',        'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000013', 'lena.fischer@fischergrants.example',   'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000014', 'director@harborlight.example',         'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000015', 'office@northsideyouth.example',        'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000016', 'admin@cedarvalleyfoodbank.example',    'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000017', 'hello@tidewaterarts.example',          'authenticated', 'authenticated');

-- ------------------------------------------------------------------------------- workspaces
insert into public.workspaces (id, kind, passport_org_id, handle, display_name, legal_name, ein, brand, settings, verification_level, org_projection, org_projection_at) values
  ('20000000-0000-7000-8000-000000000001', 'funder', '30000000-0000-7000-8000-000000000001', 'riverbend',
   'Riverbend Community Foundation', 'Riverbend Community Foundation', '001000001',
   '{"accent":"#1F6F8B","onAccent":"#FFFFFF","fontPreference":"system"}',
   '{"defaultRail":"auto","transparency":true,"gatedTools":["commit_decisions","release_tranche","submit_application","sign_agreement","accept_award","send_communication"]}',
   'L3', null, null),
  ('20000000-0000-7000-8000-000000000002', 'funder', '30000000-0000-7000-8000-000000000002', 'cascade-county',
   'Cascade County Health Department', 'County of Cascade, Health Department', '001000002',
   '{"accent":"#7A4F01","onAccent":"#FFFFFF","fontPreference":"system"}', '{"defaultRail":"auto","transparency":true}', 'L3', null, null),
  ('20000000-0000-7000-8000-000000000003', 'funder', '30000000-0000-7000-8000-000000000003', 'summitline-giving',
   'Summitline Corporate Giving', 'Summitline Outfitters, Inc.', '001000003',
   '{"accent":"#3D4A8F","onAccent":"#FFFFFF","fontPreference":"system"}', '{"defaultRail":"auto","transparency":false}', 'L2', null, null),
  ('20000000-0000-7000-8000-000000000011', 'applicant', '30000000-0000-7000-8000-000000000011', 'alder-creek',
   'Alder Creek Family Services', 'Alder Creek Family Services', '001000011', '{}', '{}', 'L3',
   '{"id":"30000000-0000-7000-8000-000000000011","name":"Alder Creek Family Services","orgType":{"code":"non_profit_with_501c3"},"status":{"value":"active"},"identifiers":{"org:us:ein":"001000011"},"mission":"Health navigation and family support for rural households.","yearFounded":2009,"addresses":{"primary":{"street1":"410 Alder Creek Road","city":"Fallbrook","stateOrProvince":"OR","postalCode":"97000","country":"US"}},"emails":{"primary":"info@aldercreek.example"},"phones":{"primary":{"countryCode":"+1","number":"5035550142"}},"socials":{"website":"https://aldercreek.example"},"customFields":{"verificationLevel":{"name":"verificationLevel","fieldType":"string","value":"L3"}}}',
   now()),
  ('20000000-0000-7000-8000-000000000012', 'applicant', '30000000-0000-7000-8000-000000000012', 'harbor-light',
   'Harbor Light Shelter', 'Harbor Light Shelter Association', '001000012', '{}', '{}', 'L3',
   '{"id":"30000000-0000-7000-8000-000000000012","name":"Harbor Light Shelter","orgType":{"code":"non_profit_with_501c3"},"status":{"value":"active"},"identifiers":{"org:us:ein":"001000012"},"mission":"Emergency shelter and housing navigation.","yearFounded":1998,"addresses":{"primary":{"street1":"88 Quay Street","city":"Port Marlow","stateOrProvince":"OR","postalCode":"97001","country":"US"}},"emails":{"primary":"office@harborlight.example"},"customFields":{"verificationLevel":{"name":"verificationLevel","fieldType":"string","value":"L3"}}}',
   now()),
  ('20000000-0000-7000-8000-000000000013', 'applicant', '30000000-0000-7000-8000-000000000013', 'northside-youth',
   'Northside Youth Collective', 'Northside Youth Collective', '001000013', '{}', '{}', 'L2', null, null),
  ('20000000-0000-7000-8000-000000000014', 'applicant', '30000000-0000-7000-8000-000000000014', 'cedar-valley-food-bank',
   'Cedar Valley Food Bank', 'Cedar Valley Food Bank', '001000014', '{}', '{}', 'L1', null, null),
  ('20000000-0000-7000-8000-000000000015', 'applicant', '30000000-0000-7000-8000-000000000015', 'tidewater-arts',
   'Tidewater Arts Alliance', 'Tidewater Arts Alliance', '001000015', '{}', '{}', 'L0', null, null);

insert into public.workspace_members (workspace_id, user_id, role, scope, mfa_enrolled_at) values
  ('20000000-0000-7000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin', '{}', now()),
  ('20000000-0000-7000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'finance', '{}', now()),
  ('20000000-0000-7000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'reviewer', '{}', null),
  ('20000000-0000-7000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'external_reviewer',
   '{"competitionIds":["50000000-0000-7000-8000-000000000001"]}', null),
  ('20000000-0000-7000-8000-000000000002', '10000000-0000-4000-8000-000000000005', 'admin', '{}', now()),
  ('20000000-0000-7000-8000-000000000003', '10000000-0000-4000-8000-000000000006', 'admin', '{}', now()),
  ('20000000-0000-7000-8000-000000000011', '10000000-0000-4000-8000-000000000011', 'admin', '{}', now()),
  ('20000000-0000-7000-8000-000000000011', '10000000-0000-4000-8000-000000000012', 'editor', '{}', null),
  ('20000000-0000-7000-8000-000000000011', '10000000-0000-4000-8000-000000000013', 'consultant',
   '{"applicationIds":["60000000-0000-7000-8000-000000000001"]}', null),
  ('20000000-0000-7000-8000-000000000012', '10000000-0000-4000-8000-000000000014', 'admin', '{}', now()),
  ('20000000-0000-7000-8000-000000000013', '10000000-0000-4000-8000-000000000015', 'admin', '{}', null),
  ('20000000-0000-7000-8000-000000000014', '10000000-0000-4000-8000-000000000016', 'admin', '{}', null),
  ('20000000-0000-7000-8000-000000000015', '10000000-0000-4000-8000-000000000017', 'admin', '{}', null);

insert into public.consents (applicant_workspace_id, funder_workspace_id, basis, scopes, granted_by) values
  ('20000000-0000-7000-8000-000000000011', '20000000-0000-7000-8000-000000000001', 'application', '{org:read}', '10000000-0000-4000-8000-000000000011'),
  ('20000000-0000-7000-8000-000000000012', '20000000-0000-7000-8000-000000000001', 'application', '{org:read}', '10000000-0000-4000-8000-000000000014'),
  ('20000000-0000-7000-8000-000000000011', '20000000-0000-7000-8000-000000000002', 'application', '{org:read}', '10000000-0000-4000-8000-000000000011');

-- ------------------------------------------------------------------- shared form library
-- workspace_id null = shared library. Mappings follow the CommonGrants MappingSchema
-- (field / const / switch) against the applicant's OrganizationBase.
insert into public.forms (id, version, workspace_id, title, description, purpose, json_schema, ui_schema, mapping_from_cg, mapping_to_cg, field_meta, published_at) values
  ('40000000-0000-7000-8000-000000000001', 1, null, 'Letter of intent', 'A short first-stage form.', 'loi',
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["orgName","projectTitle","summary","requestedAmount"],"properties":{"orgName":{"type":"string","title":"Organization name"},"ein":{"type":"string","title":"EIN","pattern":"^[0-9]{9}$"},"projectTitle":{"type":"string","title":"Project title","maxLength":140},"summary":{"type":"string","title":"Project summary","maxLength":3000},"requestedAmount":{"type":"object","title":"Amount requested","required":["amount","currency"],"properties":{"amount":{"type":"string"},"currency":{"type":"string","const":"USD"}}}}}',
   '{"type":"VerticalLayout","elements":[{"type":"Group","label":"Organization","elements":[{"type":"Control","scope":"#/properties/orgName","options":{"widget":"passportField"}},{"type":"Control","scope":"#/properties/ein","options":{"widget":"passportField"}}]},{"type":"Group","label":"Project","elements":[{"type":"Control","scope":"#/properties/projectTitle"},{"type":"Control","scope":"#/properties/summary","options":{"widget":"richText","wordCount":400}},{"type":"Control","scope":"#/properties/requestedAmount","options":{"widget":"money"}}]}]}',
   '{"orgName":{"field":"name"},"ein":{"field":"identifiers.org:us:ein"}}',
   '{"title":{"field":"projectTitle"},"requestedAmount":{"field":"requestedAmount"}}',
   '{"ein":{"pii":false,"reviewerVisible":true}}', now()),
  ('40000000-0000-7000-8000-000000000002', 1, null, 'Common application', 'The full proposal narrative.', 'application',
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["orgName","mission","needStatement","approach","outcomes"],"properties":{"orgName":{"type":"string","title":"Organization name"},"mission":{"type":"string","title":"Mission"},"yearFounded":{"type":"integer","title":"Year founded","minimum":1800},"website":{"type":"string","title":"Website","format":"uri"},"contactEmail":{"type":"string","title":"Contact email","format":"email"},"needStatement":{"type":"string","title":"Statement of need","maxLength":6000},"approach":{"type":"string","title":"Approach","maxLength":6000},"outcomes":{"type":"string","title":"Expected outcomes","maxLength":4000},"fiscalSponsor":{"type":"boolean","title":"Applying through a fiscal sponsor?"},"fiscalSponsorName":{"type":"string","title":"Fiscal sponsor name"},"lettersOfSupport":{"type":"array","title":"Letters of support","items":{"type":"string"}}},"if":{"properties":{"fiscalSponsor":{"const":true}},"required":["fiscalSponsor"]},"then":{"required":["fiscalSponsorName"]}}',
   '{"type":"Categorization","elements":[{"type":"Category","label":"Organization","elements":[{"type":"Control","scope":"#/properties/orgName","options":{"widget":"passportField"}},{"type":"Control","scope":"#/properties/mission","options":{"widget":"passportField"}},{"type":"Control","scope":"#/properties/yearFounded"},{"type":"Control","scope":"#/properties/website"},{"type":"Control","scope":"#/properties/contactEmail","options":{"pii":true}}]},{"type":"Category","label":"Proposal","elements":[{"type":"Control","scope":"#/properties/needStatement","options":{"widget":"richText","wordCount":800}},{"type":"Control","scope":"#/properties/approach","options":{"widget":"richText","wordCount":800}},{"type":"Control","scope":"#/properties/outcomes","options":{"widget":"richText","wordCount":500}}]},{"type":"Category","label":"Sponsor and attachments","elements":[{"type":"Control","scope":"#/properties/fiscalSponsor"},{"type":"Control","scope":"#/properties/fiscalSponsorName","rule":{"effect":"SHOW","condition":{"scope":"#/properties/fiscalSponsor","schema":{"const":true}}}},{"type":"Control","scope":"#/properties/lettersOfSupport","options":{"widget":"fileRef"}}]}]}',
   '{"orgName":{"field":"name"},"mission":{"field":"mission"},"yearFounded":{"field":"yearFounded"},"website":{"field":"socials.website"},"contactEmail":{"field":"emails.primary"}}',
   '{}', '{"contactEmail":{"pii":true}}', now()),
  ('40000000-0000-7000-8000-000000000003', 1, null, 'Project budget', 'Budget table by category.', 'application',
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["lines"],"properties":{"lines":{"type":"array","title":"Budget lines","items":{"type":"object","required":["category","amount"],"properties":{"category":{"type":"string","enum":["Personnel","Fringe","Travel","Equipment","Supplies","Contractual","Other","Indirect"]},"label":{"type":"string"},"amount":{"type":"number","minimum":0},"notes":{"type":"string"}}}}}}',
   '{"type":"VerticalLayout","elements":[{"type":"Control","scope":"#/properties/lines","options":{"widget":"budgetTable"}}]}',
   '{}', '{}', '{}', now()),
  ('40000000-0000-7000-8000-000000000004', 1, null, 'Progress report', 'Interim narrative and spending to date.', 'report',
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["progress","spentToDate"],"properties":{"orgName":{"type":"string","title":"Organization name"},"progress":{"type":"string","title":"Progress against outcomes","maxLength":6000},"challenges":{"type":"string","title":"Challenges and changes","maxLength":4000},"peopleServed":{"type":"integer","title":"People served this period","minimum":0},"spentToDate":{"type":"number","title":"Spent to date","minimum":0}}}',
   '{"type":"VerticalLayout","elements":[{"type":"Control","scope":"#/properties/orgName","options":{"widget":"passportField"}},{"type":"Control","scope":"#/properties/progress","options":{"widget":"richText"}},{"type":"Control","scope":"#/properties/challenges","options":{"widget":"richText"}},{"type":"Control","scope":"#/properties/peopleServed"},{"type":"Control","scope":"#/properties/spentToDate"}]}',
   '{"orgName":{"field":"name"}}', '{}', '{}', now()),
  ('40000000-0000-7000-8000-000000000005', 1, null, 'Final report', 'Closeout narrative, outcomes and final spending.', 'report',
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["outcomes","totalSpent"],"properties":{"orgName":{"type":"string","title":"Organization name"},"outcomes":{"type":"string","title":"Outcomes achieved","maxLength":8000},"lessons":{"type":"string","title":"Lessons learned","maxLength":4000},"peopleServed":{"type":"integer","title":"People served in total","minimum":0},"totalSpent":{"type":"number","title":"Total spent","minimum":0},"unspentFunds":{"type":"number","title":"Unspent funds","minimum":0}}}',
   '{"type":"VerticalLayout","elements":[{"type":"Control","scope":"#/properties/orgName","options":{"widget":"passportField"}},{"type":"Control","scope":"#/properties/outcomes","options":{"widget":"richText"}},{"type":"Control","scope":"#/properties/lessons","options":{"widget":"richText"}},{"type":"Control","scope":"#/properties/peopleServed"},{"type":"Control","scope":"#/properties/totalSpent"},{"type":"Control","scope":"#/properties/unspentFunds"}]}',
   '{"orgName":{"field":"name"}}', '{}', '{}', now()),
  ('40000000-0000-7000-8000-000000000006', 1, null, 'Federal subaward data (FFATA / 2 CFR 200 pack)', 'Template pack for government funders: UEI, federal award identifiers and executive compensation questions.', 'other',
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["uei","placeOfPerformanceState"],"properties":{"uei":{"type":"string","title":"Unique Entity ID (SAM.gov)","pattern":"^[A-Z0-9]{12}$"},"federalAwardIdentifier":{"type":"string","title":"Federal award identification number (FAIN)"},"assistanceListing":{"type":"string","title":"Assistance listing number","pattern":"^[0-9]{2}\\.[0-9]{3}$"},"placeOfPerformanceState":{"type":"string","title":"Primary place of performance (state)","minLength":2,"maxLength":2},"indirectCostRate":{"type":"number","title":"Indirect cost rate (%)","minimum":0,"maximum":100},"execCompReportingRequired":{"type":"boolean","title":"Executive compensation reporting required?"}}}',
   '{"type":"VerticalLayout","elements":[{"type":"Control","scope":"#/properties/uei"},{"type":"Control","scope":"#/properties/federalAwardIdentifier"},{"type":"Control","scope":"#/properties/assistanceListing"},{"type":"Control","scope":"#/properties/placeOfPerformanceState"},{"type":"Control","scope":"#/properties/indirectCostRate"},{"type":"Control","scope":"#/properties/execCompReportingRequired"}]}',
   '{"placeOfPerformanceState":{"field":"addresses.primary.stateOrProvince"}}', '{}', '{}', now());

-- --------------------------------------------------------------------- rubrics, templates
insert into public.rubrics (id, version, workspace_id, name, criteria, overall) values
  ('41000000-0000-7000-8000-000000000001', 1, null, 'General proposal rubric',
   '[{"key":"need","label":"Need","description":"Is the need clear and documented?","weight":0.3,"scale":{"type":"numeric","min":1,"max":5},"guidance":"5 = specific, sourced, local."},{"key":"approach","label":"Approach","description":"Is the plan credible?","weight":0.3,"scale":{"type":"numeric","min":1,"max":5}},{"key":"capacity","label":"Capacity","description":"Can the organization deliver?","weight":0.2,"scale":{"type":"numeric","min":1,"max":5}},{"key":"budget","label":"Budget","description":"Is the budget reasonable?","weight":0.2,"scale":{"type":"categorical","options":[{"value":"weak","score":0.25},{"value":"adequate","score":0.6},{"value":"strong","score":1}]}}]',
   '{"recommendations":["fund","fund_with_conditions","do_not_fund"],"spreadThreshold":15}'),
  ('41000000-0000-7000-8000-000000000002', 1, '20000000-0000-7000-8000-000000000001', 'Riverbend LOI screen',
   '[{"key":"fit","label":"Fit with program goals","weight":0.6,"scale":{"type":"numeric","min":1,"max":5}},{"key":"readiness","label":"Readiness","weight":0.4,"scale":{"type":"numeric","min":1,"max":5}}]',
   '{"recommendations":["invite","decline"],"spreadThreshold":20}');

insert into public.templates (id, workspace_id, kind, name, body) values
  ('42000000-0000-7000-8000-000000000001', null, 'email', 'Application received',
   E'Hello {{applicant.contactName}},\n\nWe received **{{application.title}}** for {{opportunity.title}} on {{application.submittedAt}}. You can follow its status at {{application.statusUrl}}.\n\n{{funder.name}}'),
  ('42000000-0000-7000-8000-000000000002', null, 'letter', 'Decline letter',
   E'Dear {{applicant.contactName}},\n\nThank you for applying to {{opportunity.title}}. After review, {{funder.name}} is not able to fund **{{application.title}}** in this cycle.\n\n{{decision.rationale}}\n\nWith thanks,\n{{funder.signatory}}'),
  ('42000000-0000-7000-8000-000000000003', null, 'letter', 'Award letter',
   E'Dear {{applicant.contactName}},\n\n{{funder.name}} is pleased to offer {{applicant.name}} a grant of **{{award.amount}}** for {{award.title}}, for the period {{award.startDate}} to {{award.endDate}}.\n\nPlease review and sign the grant agreement at {{award.url}}.\n\n{{funder.signatory}}'),
  ('42000000-0000-7000-8000-000000000004', null, 'agreement', 'Standard grant agreement',
   E'# Grant agreement\n\nBetween **{{funder.legalName}}** ("Funder") and **{{applicant.legalName}}** ("Grantee").\n\n1. **Grant.** The Funder awards {{award.amount}} for {{award.title}}.\n2. **Period.** {{award.startDate}} to {{award.endDate}}.\n3. **Payments.** As set out in the payment schedule: {{award.scheduleSummary}}. Payments are made to the Grantee''s verified payee destination through OpenGrants Passport.\n4. **Reporting.** {{award.requirementsSummary}}\n5. **Conditions.** {{award.conditions}}'),
  ('42000000-0000-7000-8000-000000000005', null, 'email', 'Report reminder',
   E'Hello {{applicant.contactName}},\n\n**{{requirement.title}}** for {{award.title}} is due {{requirement.dueAt}} ({{requirement.dueIn}}). Open it at {{requirement.url}}.\n\n{{funder.name}}');

-- ---------------------------------------------------- program, opportunity, competition
insert into public.programs (id, workspace_id, name, description, fiscal_year, budget_amount_minor, currency, defaults) values
  ('43000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 'Community Health',
   'Access to care for rural and underserved families.', 2027, 120000000, 'USD',
   '{"rubricId":"41000000-0000-7000-8000-000000000001","agreementTemplateId":"42000000-0000-7000-8000-000000000004","awardLetterTemplateId":"42000000-0000-7000-8000-000000000003","declineLetterTemplateId":"42000000-0000-7000-8000-000000000002","reminderPlan":[-30,-14,-7,0,3,14],"requirementPlan":[{"type":"report","title":"Interim report","formId":"40000000-0000-7000-8000-000000000004","formVersion":1,"dueAfterDays":180},{"type":"report","title":"Final report","formId":"40000000-0000-7000-8000-000000000005","formVersion":1,"dueAfterDays":395}]}'),
  ('43000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000002', 'Clinic Capacity',
   'County support for community clinics.', 2026, 60000000, 'USD', '{}');

insert into public.opportunities (id, workspace_id, program_id, slug, title, description, status, funding, key_dates, accepted_applicant_types, eligibility_rules, published_at) values
  ('44000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '43000000-0000-7000-8000-000000000001',
   'rural-health-access-2027', 'Rural Health Access Grants 2027',
   'Grants of $50,000 to $150,000 for organizations that help rural families reach primary and preventive care.',
   'open',
   '{"totalAmountAvailable":{"amount":"1200000.00","currency":"USD"},"minAwardAmount":{"amount":"50000.00","currency":"USD"},"maxAwardAmount":{"amount":"150000.00","currency":"USD"},"estimatedAwardCount":10}',
   '{"postDate":{"name":"Opens","eventType":"singleDate","date":"2027-01-15"},"closeDate":{"name":"Full proposals due","eventType":"singleDate","date":"2027-04-30"},"otherDates":{"loiDue":{"name":"Letters of intent due","eventType":"singleDate","date":"2027-02-28"},"decisions":{"name":"Decisions announced","eventType":"singleDate","date":"2027-05-18"}}}',
   '{organization}',
   '{"all":[{"label":"501(c)(3) public charity","path":"org.orgType.code","op":"in","value":["non_profit_with_501c3"],"explain":"Applicants must be 501(c)(3) organizations."},{"label":"Based in Oregon or Washington","path":"org.addresses.primary.stateOrProvince","op":"in","value":["OR","WA"],"explain":"The program serves Oregon and Washington."},{"label":"Passport level L1 or higher","path":"org.customFields.verificationLevel.value","op":"gte","value":"L1","order":["L0","L1","L2","L3"],"explain":"A verified organization record is required to apply."},{"label":"Annual revenue under $5M","path":"profile.financials.annualRevenue","op":"lt","value":5000000,"missing":"unknown","explain":"The program prioritizes small and mid-sized organizations."}]}',
   now());

insert into public.competitions (id, workspace_id, opportunity_id, title, description, instructions, status, key_dates, stages, forms, validation, accepted_applicant_types) values
  ('50000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '44000000-0000-7000-8000-000000000001',
   'Rural Health Access Grants 2027', 'Two stages: a letter of intent, then an invited full proposal.',
   'Start with the letter of intent. Organizations invited to the second stage complete the common application and a project budget.',
   'open',
   '{"openDate":{"name":"Opens","eventType":"singleDate","date":"2027-01-15"},"closeDate":{"name":"Closes","eventType":"singleDate","date":"2027-04-30"}}',
   '[{"key":"loi","label":"Letter of intent","forms":{"40000000-0000-7000-8000-000000000001":1},"opens":"2027-01-15T16:00:00Z","closes":"2027-03-01T07:59:00Z","rubricId":"41000000-0000-7000-8000-000000000002","reviewers":"pool:loi","entryFrom":[],"requiresSubmission":true,"decisionRequired":true},{"key":"full","label":"Full proposal","forms":{"40000000-0000-7000-8000-000000000002":1,"40000000-0000-7000-8000-000000000003":1},"opens":"2027-03-15T16:00:00Z","closes":"2027-05-01T06:59:00Z","rubricId":"41000000-0000-7000-8000-000000000001","entryFrom":["loi"],"requiresSubmission":true,"decisionRequired":true}]',
   '{"40000000-0000-7000-8000-000000000001":1,"40000000-0000-7000-8000-000000000002":1,"40000000-0000-7000-8000-000000000003":1}',
   '{"loi":{"required":["40000000-0000-7000-8000-000000000001"]},"full":{"required":["40000000-0000-7000-8000-000000000002","40000000-0000-7000-8000-000000000003"]}}',
   '{organization}');

-- ------------------------------------------------------------------------- applications
insert into public.applications (id, workspace_id, applicant_workspace_id, competition_id, opportunity_id, title, stage, status, cg_status, cg_custom_value, submitted_at, verification_level_at_submit, requested_amount_minor, tags, assigned_to_user_id, eligibility) values
  ('60000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000011',
   '50000000-0000-7000-8000-000000000001', '44000000-0000-7000-8000-000000000001',
   'Mobile Health Navigation for Rural Families', 'full', 'draft', 'inProgress', null, '2027-02-21T18:30:00Z', 'L3', 15000000,
   '{rural,navigation}', '10000000-0000-4000-8000-000000000001', '{"eligible":true,"results":[]}'),
  ('60000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000012',
   '50000000-0000-7000-8000-000000000001', '44000000-0000-7000-8000-000000000001',
   'Shelter-Based Care Coordination', 'loi', 'under_review', 'custom', 'underReview', '2027-02-24T21:05:00Z', 'L3', 9000000,
   '{housing}', '10000000-0000-4000-8000-000000000001', '{"eligible":"unknown","results":[]}');

insert into public.form_responses (workspace_id, application_id, form_id, form_version, stage, response, status, provenance, section_assignments, locked_at) values
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001', 1, 'loi',
   '{"orgName":"Alder Creek Family Services","ein":"001000011","projectTitle":"Mobile Health Navigation for Rural Families","summary":"Two navigators and a van bring screening and referrals to four rural communities.","requestedAmount":{"amount":"150000.00","currency":"USD"}}',
   'complete', '{"/orgName":"passport","/ein":"passport","/projectTitle":"user","/summary":"user","/requestedAmount":"user"}', '{}', '2027-02-21T18:30:00Z'),
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000002', 1, 'full',
   '{"orgName":"Alder Creek Family Services","mission":"Health navigation and family support for rural households.","yearFounded":2009,"website":"https://aldercreek.example","contactEmail":"info@aldercreek.example","needStatement":"Families in the upper valley drive more than an hour to reach primary care."}',
   'inProgress', '{"/orgName":"passport","/mission":"passport","/yearFounded":"passport","/website":"passport","/contactEmail":"passport","/needStatement":"library"}',
   '{"Proposal":"10000000-0000-4000-8000-000000000012"}', null),
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000003', 1, 'full',
   '{}', 'notStarted', '{}', '{"Budget":"10000000-0000-4000-8000-000000000013"}', null),
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000002', '40000000-0000-7000-8000-000000000001', 1, 'loi',
   '{"orgName":"Harbor Light Shelter","ein":"001000012","projectTitle":"Shelter-Based Care Coordination","summary":"A nurse coordinator on site three days a week.","requestedAmount":{"amount":"90000.00","currency":"USD"}}',
   'complete', '{"/orgName":"passport","/ein":"passport"}', '{}', '2027-02-24T21:05:00Z');

insert into public.application_events (workspace_id, application_id, type, from_stage, to_stage, from_status, to_status, actor) values
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', 'application.submitted', 'loi', 'loi', 'draft', 'submitted', 'user:10000000-0000-4000-8000-000000000012'),
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', 'application.advanced', 'loi', 'full', 'recommended', 'draft', 'user:10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000002', 'application.submitted', 'loi', 'loi', 'draft', 'submitted', 'user:10000000-0000-4000-8000-000000000014');

insert into public.review_assignments (id, workspace_id, application_id, stage, reviewer_user_id, rubric_id, rubric_version, due_at, status) values
  ('61000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000002', 'loi',
   '10000000-0000-4000-8000-000000000003', '41000000-0000-7000-8000-000000000002', 1, '2027-03-10T07:59:00Z', 'in_progress'),
  ('61000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000002', 'loi',
   '10000000-0000-4000-8000-000000000004', '41000000-0000-7000-8000-000000000002', 1, '2027-03-10T07:59:00Z', 'assigned');

-- ------------------------------------------- one active award (Cascade County -> Alder Creek)
insert into public.awards (id, workspace_id, recipient_workspace_id, program_id, title, description, status, cg_status, funding, disbursed_at, key_dates, passport_award_id, passport_synced_at) values
  ('70000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000011',
   '43000000-0000-7000-8000-000000000002', 'Community Clinic Capacity 2026', 'Extended clinic hours and a bilingual intake coordinator.',
   'active', 'awarded',
   '{"requested":{"amountMinor":12000000,"currency":"USD"},"awarded":{"amountMinor":12000000,"currency":"USD"},"disbursed":{"amountMinor":7000000,"currency":"USD"}}',
   '2026-07-09T17:00:00Z', '{"startDate":"2026-07-01","endDate":"2027-06-30"}', 'awd_seed_cascade_0001', '2026-07-09T17:00:00Z');

insert into public.agreements (workspace_id, award_id, template_id, version, status, rendered_pdf_path, document_sha256, grantee_signature, funder_signature, executed_at) values
  ('20000000-0000-7000-8000-000000000002', '70000000-0000-7000-8000-000000000001', '42000000-0000-7000-8000-000000000004', 1, 'executed',
   'agreements/70000000-0000-7000-8000-000000000001/v1.pdf', 'c41e0f6a7d1b4b0e9a2f5c8d3e7b1a6f0d9c8b7a6e5f4d3c2b1a0f9e8d7c9ab2',
   '{"name":"Maria Santos","userId":"10000000-0000-4000-8000-000000000011","ip":"203.0.113.24","at":"2026-06-26T18:02:00Z","hash":"c41e0f6a7d1b4b0e9a2f5c8d3e7b1a6f0d9c8b7a6e5f4d3c2b1a0f9e8d7c9ab2"}',
   '{"name":"Cascade County Grants Office","userId":"10000000-0000-4000-8000-000000000005","ip":"203.0.113.80","at":"2026-06-29T16:40:00Z","hash":"c41e0f6a7d1b4b0e9a2f5c8d3e7b1a6f0d9c8b7a6e5f4d3c2b1a0f9e8d7c9ab2"}',
   '2026-06-29T16:40:00Z');

insert into public.payment_schedules (id, workspace_id, award_id) values
  ('71000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000002', '70000000-0000-7000-8000-000000000001');

insert into public.tranches (id, workspace_id, schedule_id, award_id, seq, amount_minor, condition, status, due_at, released_by, released_at, mode, passport_disbursement_id, passport_status, idempotency_key) values
  ('72000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000002', '71000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001',
   1, 7000000, '{"type":"onExecution"}', 'settled', '2026-06-29T16:40:00Z', '10000000-0000-4000-8000-000000000005', '2026-07-07T17:00:00Z',
   'facilitated', 'dsb_seed_cascade_0001', 'settled', 'trn_72000000000070008000000000000001'),
  ('72000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000002', '71000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001',
   2, 5000000, '{"type":"onReportAccepted","requirementId":"73000000-0000-7000-8000-000000000001"}', 'scheduled', null, null, null, null, null, null, null);

insert into public.requirements (id, workspace_id, award_id, type, title, form_id, form_version, due_at, grace_days, status, releases_tranche_id) values
  ('73000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000002', '70000000-0000-7000-8000-000000000001',
   'report', 'Interim report', '40000000-0000-7000-8000-000000000004', 1, '2027-01-15T07:59:00Z', 14, 'due', '72000000-0000-7000-8000-000000000002'),
  ('73000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000002', '70000000-0000-7000-8000-000000000001',
   'report', 'Final report', '40000000-0000-7000-8000-000000000005', 1, '2027-07-31T06:59:00Z', 14, 'scheduled', null);

insert into public.budgets (workspace_id, award_id, kind, categories, lines, period_start, period_end) values
  ('20000000-0000-7000-8000-000000000002', '70000000-0000-7000-8000-000000000001', 'approved',
   '["Personnel","Supplies","Indirect"]',
   '[{"category":"Personnel","label":"Bilingual intake coordinator","amount_minor":8400000},{"category":"Supplies","label":"Clinic supplies","amount_minor":2400000},{"category":"Indirect","label":"Indirect at 10%","amount_minor":1200000}]',
   '2026-07-01', '2027-06-30');

insert into public.grantee_records (workspace_id, applicant_workspace_id, owner_user_id, tags, notes) values
  ('20000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000011', '10000000-0000-4000-8000-000000000005', '{clinic,returning}', 'Second award. Reports arrive on time.'),
  ('20000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '{rural}', null);

insert into public.threads (id, workspace_id, funder_workspace_id, applicant_workspace_id, subject_type, subject_id, visibility) values
  ('74000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000011', 'application', '60000000-0000-7000-8000-000000000001', 'shared'),
  ('74000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', null, 'application', '60000000-0000-7000-8000-000000000001', 'funder_internal');
insert into public.messages (thread_id, author, author_user_id, body) values
  ('74000000-0000-7000-8000-000000000001', 'user:10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Thanks for the letter of intent. You are invited to submit a full proposal by April 30.'),
  ('74000000-0000-7000-8000-000000000002', 'user:10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Strong fit. Ask about the van maintenance line at interview.');

insert into public.answers (workspace_id, key, title, body) values
  ('20000000-0000-7000-8000-000000000011', 'mission', 'Mission statement', 'Health navigation and family support for rural households.'),
  ('20000000-0000-7000-8000-000000000011', 'need.rural-access', 'Statement of need: rural access', 'Families in the upper valley drive more than an hour to reach primary care.');

insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data, occurred_at) values
  ('20000000-0000-7000-8000-000000000001', 'user:10000000-0000-4000-8000-000000000001', 'opportunity.published', 'opportunity', '44000000-0000-7000-8000-000000000001', '{}', '2027-01-15T16:00:00Z'),
  ('20000000-0000-7000-8000-000000000001', 'user:10000000-0000-4000-8000-000000000012', 'application.submitted', 'application', '60000000-0000-7000-8000-000000000001', '{"stage":"loi","verificationLevel":"L3"}', '2027-02-21T18:30:00Z'),
  ('20000000-0000-7000-8000-000000000002', 'user:10000000-0000-4000-8000-000000000005', 'agreement.executed', 'award', '70000000-0000-7000-8000-000000000001', '{"documentSha256":"c41e0f6a7d1b4b0e9a2f5c8d3e7b1a6f0d9c8b7a6e5f4d3c2b1a0f9e8d7c9ab2"}', '2026-06-29T16:40:00Z'),
  ('20000000-0000-7000-8000-000000000002', 'passport', 'tranche.status.changed', 'tranche', '72000000-0000-7000-8000-000000000001', '{"from":"initiated","to":"settled"}', '2026-07-09T17:00:00Z');

commit;
