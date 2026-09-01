import { CATALOG_SCHEMA_VERSION, defineCanonicalSubject } from '../../schema.js';

export const openBeltDrive = defineCanonicalSubject({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'open-belt-drive',
  slug: 'open-belt-drive',
  title: 'Open Belt Drive',
  seoDescription:
    'Explore an open belt drive interactively: same-direction rotary transmission, speed ratio, belt speed, geometry, and Brown movement 001 context.',
  summary:
    'Two pulleys connected by an uncrossed belt transmit rotation between parallel shafts. In the ideal no-slip case, the shafts turn in the same direction and pulley radii set the speed ratio.',
  classification: {
    inputMotion: 'continuous-rotary',
    outputMotion: 'continuous-rotary',
    functionalSignature: 'Continuous rotary → continuous rotary',
    components: ['belt', 'pulley', 'shaft'],
  },
  simulation: {
    status: 'interactive',
    modelId: 'foundation:belt-drive:open',
    adapter: 'atlas.analytic-belt.v0',
  },
  facts: [
    { label: 'Functional signature', value: 'continuous rotary → continuous rotary' },
    { label: 'Ideal relationship', value: 'Constant speed ratio; same direction' },
    { label: 'Degrees of freedom', value: '1 prescribed input coordinate' },
    { label: 'Components', tags: ['belt', 'pulley', 'shaft'] },
    { label: 'Atlas model', value: 'Exact analytic planar kinematics' },
    {
      label: 'Assumptions',
      value: 'Massless, inextensible belt; no slip; fixed coplanar centers; pitch-circle geometry.',
    },
  ],
});
