// SPDX-License-Identifier: AGPL-3.0-or-later
// Hand-written word lists for generated demo data. Everything is fictional: place names are invented
// (Alder, Bramble and Cinder Counties), and organization names are assembled from neutral parts.

export const FIRST_NAMES = [
  'Amara', 'Beatriz', 'Caleb', 'Dalia', 'Elias', 'Fatima', 'Gideon', 'Hana', 'Ivan', 'Jada',
  'Kofi', 'Leona', 'Marisol', 'Nadia', 'Omar', 'Paloma', 'Quinn', 'Rafael', 'Selena', 'Tariq',
  'Uma', 'Victor', 'Wren', 'Ximena', 'Yusuf', 'Zora', 'Anika', 'Bruno', 'Celeste', 'Desmond',
  'Esme', 'Felix', 'Greta', 'Hector', 'Imani', 'Jonah', 'Keiko', 'Lorenzo', 'Mina', 'Nico',
  'Odette', 'Pedro', 'Rosa', 'Soren', 'Talia', 'Ulises', 'Vera', 'Wesley', 'Yara', 'Zeke',
] as const;

export const LAST_NAMES = [
  'Abernathy', 'Baptiste', 'Castellano', 'Dunmore', 'Everly', 'Fairweather', 'Galloway', 'Hollis', 'Iwasaki', 'Jaramillo',
  'Kowalczyk', 'Lindgren', 'Moreau', 'Nakamura', 'Oyelaran', 'Pemberton', 'Quintero', 'Rasmussen', 'Salcedo', 'Thibodeaux',
  'Underhill', 'Valcourt', 'Whitlock', 'Yamashita', 'Zeller', 'Ashdown', 'Bellamy', 'Carrow', 'Delacroix', 'Ellsworth',
] as const;

/** Fictional places in Halcyon Ridge's service region. */
export const REGION_PLACES = [
  { county: 'Alder', city: 'Larkspur', zip: '95421' },
  { county: 'Alder', city: 'Alderton', zip: '95424' },
  { county: 'Alder', city: 'Fernwood Flats', zip: '95427' },
  { county: 'Bramble', city: 'Thornbury', zip: '95512' },
  { county: 'Bramble', city: 'Hedgerow', zip: '95515' },
  { county: 'Bramble', city: 'Brambleton', zip: '95518' },
  { county: 'Cinder', city: 'Cinder Falls', zip: '95633' },
  { county: 'Cinder', city: 'Ashgrove', zip: '95636' },
  { county: 'Cinder', city: 'Emberton', zip: '95639' },
] as const;

/** Places outside the region (used for a handful of ineligible applicants). */
export const OUTSIDE_PLACES = [
  { county: 'Quarry', city: 'Stonemarket', zip: '95801' },
  { county: 'Harbor', city: 'Gullhaven', zip: '95905' },
] as const;

export const STREETS = [
  'Main Street', 'Orchard Avenue', 'Mill Road', 'Juniper Lane', 'Harbor View Drive', 'Cedar Street', 'Ridgeline Road',
  'Willow Court', 'Foundry Way', 'Station Street', 'Meadowlark Avenue', 'Lantern Row',
] as const;

export type CauseArea = 'arts' | 'food' | 'education' | 'health' | 'environment' | 'housing' | 'capacity';

export const ORG_NAME_PARTS: Record<CauseArea, { stems: readonly string[]; kinds: readonly string[] }> = {
  arts: {
    stems: ['Lantern', 'Riverbend', 'Northside', 'Canvas', 'Brightline', 'Hollow Oak', 'Kiln Street', 'Saltbox', 'Tin Roof', 'Echo Park'],
    kinds: ['Youth Theater', 'Mural Collective', 'Arts Studio', 'Music Workshop', 'Dance Project', 'Poetry Circle', 'Film Lab'],
  },
  food: {
    stems: ['Harvest Table', 'Good Acre', 'Commons', 'Neighbor', 'Sunrise', 'Cornerstone', 'Open Hands', 'Greenlight', 'Hillside', 'Two Rivers'],
    kinds: ['Food Pantry', 'Community Kitchen', 'Mobile Market', 'Food Share', 'Community Garden', 'Meal Program'],
  },
  education: {
    stems: ['Bright Path', 'Keystone', 'Open Book', 'Lighthouse', 'Stepping Stone', 'Compass', 'Evergreen', 'First Light'],
    kinds: ['Tutoring Center', 'Literacy Project', 'Learning Lab', 'Mentoring Network', 'Homework Club'],
  },
  health: {
    stems: ['Wellspring', 'Harbor', 'Steady Ground', 'Kindred', 'Clearwater', 'Beacon'],
    kinds: ['Health Collaborative', 'Wellness Center', 'Peer Support Network', 'Care Circle'],
  },
  environment: {
    stems: ['Watershed', 'Green Corridor', 'Tallgrass', 'Oak Savanna', 'Creekside', 'Wild Rye'],
    kinds: ['Stewards', 'Conservancy', 'Restoration Crew', 'Tree Collective'],
  },
  housing: {
    stems: ['Hearthstone', 'Common Roof', 'Doorway', 'Keel Street', 'Safe Harbor'],
    kinds: ['Housing Alliance', 'Tenant Network', 'Home Repair Collective', 'Shelter Partners'],
  },
  capacity: {
    stems: ['Civic', 'Groundwork', 'Neighborhood', 'Porchlight', 'Mainspring'],
    kinds: ['Nonprofit Resource Center', 'Leadership Institute', 'Volunteer Hub', 'Community Council'],
  },
};

export const PROJECT_TITLES: Record<CauseArea, readonly string[]> = {
  arts: [
    'Murals on Main', 'Teen Songwriting Lab', 'Stage Door Summer Intensive', 'Youth Film Festival', 'Rhythm & Roots Drum Circle',
    'Poets in the Park', 'After-School Strings', 'Community Dance Nights', 'Zine Makers Studio', 'Open Mic Mentors',
    'Printmaking for Peace', 'Street Choir', 'Clay Together', 'Photo Voice Project', 'Youth Radio Hour',
  ],
  food: [
    'Weekend Backpack Meals', 'Mobile Market Expansion', 'Senior Grocery Delivery', 'Community Fridge Network', 'Harvest Share',
    'Cooking Skills for Families', 'School Garden to Table', 'Pantry Cold Storage Upgrade', 'Summer Meals in the Park',
  ],
  education: ['Reading Buddies', 'Math Circle', 'College Launch', 'Homework Help Hub', 'Bilingual Story Time'],
  health: ['Peer Wellness Walks', 'Teen Mental Health First Aid', 'Clinic Navigator Program', 'Healthy Moms Circle'],
  environment: ['Creek Cleanup Corps', 'Tree Canopy Project', 'Native Seed Library', 'Green Jobs for Youth'],
  housing: ['Eviction Prevention Fund', 'Home Repair Days', 'Tenant Rights Clinics', 'Warm Homes Weatherization'],
  capacity: ['Board Development Series', 'Finance Systems Upgrade', 'Volunteer Management Refresh', 'Strategic Plan 2027'],
};

export const ACTIVITY_SENTENCES = [
  'Sessions meet twice a week at our community space and are led by two experienced teaching artists.',
  'Participants work in small teams, with older youth serving as paid peer mentors.',
  'Each term ends with a public showcase where young people share their work with family and neighbors.',
  'We provide transportation passes, snacks and all materials so cost is never a barrier.',
  'Local partners host field trips so participants can see professionals at work.',
  'A youth advisory council meets monthly to plan activities and give feedback.',
  'Volunteers from the neighborhood help with set-up, outreach and translation.',
  'We track attendance and ask participants what they learned at the end of each unit.',
] as const;

export const SUMMARY_SENTENCES = [
  'This project gives young people a free, welcoming place to create, learn and lead.',
  'Participants build real skills with mentors from their own community.',
  'The program responds to what young people told us they wanted in last year’s survey.',
  'We focus on neighborhoods where after-school options are hard to find.',
  'Every participant leaves with work they are proud to share.',
  'Families are invited to take part in events throughout the year.',
] as const;

export const MISSIONS: Record<CauseArea, string> = {
  arts: 'We help young people make art that tells their stories and strengthens our neighborhoods.',
  food: 'We make sure every neighbor has enough healthy food, with dignity and choice.',
  education: 'We help children and teens become confident, lifelong learners.',
  health: 'We connect neighbors to care, support and each other.',
  environment: 'We care for the creeks, trees and open spaces that our communities share.',
  housing: 'We help families find and keep safe, affordable homes.',
  capacity: 'We help local nonprofits grow stronger so they can serve their communities well.',
};
