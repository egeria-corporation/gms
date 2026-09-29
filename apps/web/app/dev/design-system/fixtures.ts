// SPDX-License-Identifier: AGPL-3.0-or-later
// Fictional sample data for the design-system page. Nothing here refers to real organizations.
import type { ChartDatum, CountyRegion } from '@gms/ui';

export const DEMO_TZ = 'America/Los_Angeles';

export interface DemoApplication {
  id: string;
  org: string;
  project: string;
  status: 'submitted' | 'under_review' | 'invited_to_next_stage' | 'awarded' | 'declined' | 'in_progress';
  requestedCents: number;
  county: 'Alder' | 'Bramble' | 'Cinder';
  submittedAt: string;
}

export const DEMO_APPLICATIONS: DemoApplication[] = [
  {
    id: 'app-01',
    org: 'Eastside Youth Music Collective',
    project: 'After-School Strings Program',
    status: 'under_review',
    requestedCents: 2_500_000,
    county: 'Alder',
    submittedAt: '2026-08-14T17:20:00Z',
  },
  {
    id: 'app-02',
    org: 'Riverbend Food Pantry',
    project: 'Weekend Meal Bags',
    status: 'submitted',
    requestedCents: 1_200_000,
    county: 'Bramble',
    submittedAt: '2026-08-19T21:05:00Z',
  },
  {
    id: 'app-03',
    org: 'Cinder Hills Literacy Project',
    project: 'Family Reading Nights',
    status: 'awarded',
    requestedCents: 800_000,
    county: 'Cinder',
    submittedAt: '2026-07-30T16:40:00Z',
  },
  {
    id: 'app-04',
    org: 'Alder Creek Watershed Council',
    project: 'Creek Restoration Volunteers',
    status: 'invited_to_next_stage',
    requestedCents: 4_000_000,
    county: 'Alder',
    submittedAt: '2026-08-02T18:10:00Z',
  },
  {
    id: 'app-05',
    org: 'Northgate Senior Center',
    project: 'Tech Help Tuesdays',
    status: 'declined',
    requestedCents: 650_000,
    county: 'Bramble',
    submittedAt: '2026-07-22T15:00:00Z',
  },
  {
    id: 'app-06',
    org: 'Bramble Valley Arts Council',
    project: 'Mural Apprenticeships',
    status: 'under_review',
    requestedCents: 1_750_000,
    county: 'Bramble',
    submittedAt: '2026-08-21T19:30:00Z',
  },
  {
    id: 'app-07',
    org: 'Harbor Light Tenants Union',
    project: 'Know Your Rights Clinics',
    status: 'in_progress',
    requestedCents: 950_000,
    county: 'Cinder',
    submittedAt: '2026-08-25T20:15:00Z',
  },
  {
    id: 'app-08',
    org: 'Maple Street Community Garden',
    project: 'Youth Growers Summer',
    status: 'submitted',
    requestedCents: 500_000,
    county: 'Alder',
    submittedAt: '2026-08-27T22:45:00Z',
  },
  {
    id: 'app-09',
    org: 'Cedar Point Rowing Club',
    project: 'Adaptive Rowing Program',
    status: 'awarded',
    requestedCents: 1_500_000,
    county: 'Cinder',
    submittedAt: '2026-07-18T17:55:00Z',
  },
  {
    id: 'app-10',
    org: 'Lantern Youth Theater',
    project: 'Bilingual Playwriting Lab',
    status: 'under_review',
    requestedCents: 2_200_000,
    county: 'Alder',
    submittedAt: '2026-08-11T16:25:00Z',
  },
  {
    id: 'app-11',
    org: 'Southside Bike Kitchen',
    project: 'Earn-a-Bike Workshops',
    status: 'submitted',
    requestedCents: 720_000,
    county: 'Bramble',
    submittedAt: '2026-08-29T18:35:00Z',
  },
  {
    id: 'app-12',
    org: 'Willow Bend Doula Network',
    project: 'Postpartum Home Visits',
    status: 'invited_to_next_stage',
    requestedCents: 3_100_000,
    county: 'Cinder',
    submittedAt: '2026-08-06T15:50:00Z',
  },
];

/** Three fictional counties drawn as simple polygons in a 320×220 viewBox. */
export const DEMO_COUNTIES: Omit<CountyRegion, 'value'>[] = [
  { id: 'alder', name: 'Alder County', path: 'M10 20 L130 10 L150 90 L120 150 L20 140 Z' },
  { id: 'bramble', name: 'Bramble County', path: 'M130 10 L300 30 L310 120 L220 130 L150 90 Z' },
  {
    id: 'cinder',
    name: 'Cinder County',
    path: 'M20 140 L120 150 L150 90 L220 130 L310 120 L290 210 L40 205 Z',
  },
];

export const COUNTY_VIEWBOX = '0 0 320 220';

export const AWARDS_BY_QUARTER: ChartDatum[] = [
  { quarter: 'Q1', arts: 18_500_000, youth: 12_000_000, health: 9_000_000 },
  { quarter: 'Q2', arts: 22_000_000, youth: 15_500_000, health: 8_000_000 },
  { quarter: 'Q3', arts: 19_750_000, youth: 17_250_000, health: 11_500_000 },
  { quarter: 'Q4', arts: 25_000_000, youth: 14_000_000, health: 12_750_000 },
];

export const APPLICATIONS_BY_MONTH: ChartDatum[] = [
  { month: 'Apr', submitted: 42, awarded: 9 },
  { month: 'May', submitted: 58, awarded: 12 },
  { month: 'Jun', submitted: 71, awarded: 15 },
  { month: 'Jul', submitted: 64, awarded: 14 },
  { month: 'Aug', submitted: 88, awarded: 19 },
  { month: 'Sep', submitted: 95, awarded: 21 },
];

export const PAYMENTS_BY_MONTH: ChartDatum[] = [
  { month: 'Apr', sent: 4_200_000 },
  { month: 'May', sent: 6_850_000 },
  { month: 'Jun', sent: 5_100_000 },
  { month: 'Jul', sent: 9_400_000 },
  { month: 'Aug', sent: 7_750_000 },
  { month: 'Sep', sent: 11_200_000 },
];

export const PORTFOLIO_MIX: ChartDatum[] = [
  { area: 'Arts & culture', amount: 85_250_000 },
  { area: 'Youth development', amount: 58_750_000 },
  { area: 'Health', amount: 41_250_000 },
  { area: 'Environment', amount: 22_500_000 },
  { area: 'Housing', amount: 14_000_000 },
];
