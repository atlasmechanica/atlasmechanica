import { CATALOG_SCHEMA_VERSION, defineCanonicalSubject } from '../../schema.js';

export const quarterTurnBeltDrive = defineCanonicalSubject({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'quarter-turn-belt-drive',
  slug: 'quarter-turn-belt-drive',
  title: 'Quarter-Turn Belt Drive',
  seoDescription:
    'Understand a quarter-turn belt drive: continuous rotary transmission between perpendicular shaft axes, guide-pulley routing, and Brown movement 003 context.',
  summary:
    'A quarter-turn belt drive transmits continuous rotary motion between shafts whose axes are at right angles. Brown movement 003 uses two side-by-side guide pulleys, one for each belt leaf, to redirect one continuous belt between the perpendicular shafts.',
  classification: {
    inputMotion: 'continuous-rotary',
    outputMotion: 'perpendicular-continuous-rotary',
    functionalSignature: 'Continuous rotary → perpendicular continuous rotary',
    components: ['belt', 'pulley', 'guide pulley', 'shaft'],
  },
  simulation: {
    status: 'planned',
    modelId: 'foundation:belt-drive:quarter-turn-guided',
    adapter: 'atlas.spatial-belt.v0',
  },
  facts: [
    { label: 'Functional signature', value: 'continuous rotary → perpendicular continuous rotary' },
    { label: 'Shaft relationship', value: 'Input and output shaft axes are perpendicular.' },
    {
      label: 'Ideal relationship',
      value: 'Power-pulley speed-ratio magnitude is set by pitch radii; passive guide pulleys redirect the belt without changing its ideal linear speed.',
    },
    { label: 'Degrees of freedom', value: '1 prescribed input coordinate' },
    { label: 'Components', tags: ['belt', 'power pulley', 'guide pulley', 'shaft'] },
    { label: 'Atlas model', value: 'Spatial belt model planned' },
    {
      label: 'Brown 003 arrangement',
      value: 'Two guide pulleys sit side by side, with one guide pulley carrying each leaf of the belt.',
    },
    {
      label: 'Planned idealization',
      value: 'Fixed shaft axes and passive guide pulleys; system-level angular ratios use the lumped ideal pitch-speed relation v = rω. Brown 003 requires lateral tracking slip across pulley faces; local slip/creep kinematics, tension, contact forces, belt deformation, and frictional loss are not yet modeled.',
    },
  ],
});
