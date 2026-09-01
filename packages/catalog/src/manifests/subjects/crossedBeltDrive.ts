import { CATALOG_SCHEMA_VERSION, defineCanonicalSubject } from '../../schema.js';

export const crossedBeltDrive = defineCanonicalSubject({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'crossed-belt-drive',
  slug: 'crossed-belt-drive',
  title: 'Crossed Belt Drive',
  seoDescription:
    'Explore a crossed belt drive interactively: reversed rotary transmission, ideal speed ratio, belt geometry, and Brown movement 002 context.',
  summary:
    'Cross the belt between two parallel pulleys and the driven shaft reverses direction. In the ideal no-slip model, the pulley-size ratio is unchanged; only its sign changes.',
  classification: {
    inputMotion: 'continuous-rotary',
    outputMotion: 'reversed-continuous-rotary',
    functionalSignature: 'Continuous rotary → reversed continuous rotary',
    components: ['belt', 'pulley', 'shaft'],
  },
  simulation: {
    status: 'interactive',
    modelId: 'foundation:belt-drive:crossed',
    adapter: 'atlas.analytic-belt.v0',
  },
  facts: [
    { label: 'Functional signature', value: 'continuous rotary → reversed continuous rotary' },
    { label: 'Ideal relationship', value: 'Constant speed-ratio magnitude; opposite direction' },
    { label: 'Degrees of freedom', value: '1 prescribed input coordinate' },
    { label: 'Components', tags: ['belt', 'pulley', 'shaft'] },
    { label: 'Atlas model', value: 'Exact analytic planar kinematics' },
    {
      label: 'Geometry condition',
      value: 'Center distance must exceed the sum of the pitch radii for the ideal crossed tangent construction.',
    },
    {
      label: 'Assumptions',
      value:
        'Massless, inextensible belt; no slip; fixed coplanar centers; no belt self-contact or lateral dynamics.',
    },
  ],
});
