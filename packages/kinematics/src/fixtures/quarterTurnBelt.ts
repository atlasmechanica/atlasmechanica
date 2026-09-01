import {
  SIMULATION_MODEL_SCHEMA_VERSION,
  quantity,
  type SimulationModel,
} from '@atlasmechanica/model';

const zero = quantity(0, 'mm');
const zeroAngle = quantity(0, 'rad');

/**
 * Canonical fixed-axis layout for the Brown 003 family.
 *
 * The lower power pulley axis lies along +X. The upper power pulley and the
 * two side-by-side guide pulleys lie on +Z axes. The guide centers are offset
 * slightly along Z to retain Brown's one-guide-per-belt-leaf arrangement.
 * Exact belt contact/tangent geometry is derived separately from this layout.
 */
export const canonicalQuarterTurnBeltModel: SimulationModel = {
  schemaVersion: SIMULATION_MODEL_SCHEMA_VERSION,
  id: 'foundation:belt-drive:quarter-turn-guided',
  subject: 'belt-drive',
  variant: 'quarter-turn-guided',
  parameters: {
    'driver-radius': {
      id: 'driver-radius',
      label: 'Driver pulley pitch radius',
      kind: 'length',
      default: quantity(45, 'mm'),
      domain: { min: quantity(1, 'mm') },
    },
    'driven-radius': {
      id: 'driven-radius',
      label: 'Driven pulley pitch radius',
      kind: 'length',
      default: quantity(60, 'mm'),
      domain: { min: quantity(1, 'mm') },
    },
    'guide-radius': {
      id: 'guide-radius',
      label: 'Guide pulley pitch radius',
      kind: 'length',
      default: quantity(20, 'mm'),
      domain: { min: quantity(1, 'mm') },
    },
  },
  systems: {
    fixedAxisBelt: {
      dimensionality: 'spatial-fixed-axis',
      pulleys: {
        driver: {
          id: 'driver',
          label: 'Lower power pulley',
          role: 'driver',
          center: { x: zero, y: zero, z: zero },
          axis: [1, 0, 0],
          pitchRadius: { parameter: 'driver-radius' },
          coordinate: 'driver-angle',
        },
        'guide-a': {
          id: 'guide-a',
          label: 'Guide pulley A',
          role: 'guide',
          center: {
            x: quantity(0, 'mm'),
            y: quantity(160, 'mm'),
            z: quantity(-12, 'mm'),
          },
          axis: [0, 0, 1],
          pitchRadius: { parameter: 'guide-radius' },
          coordinate: 'guide-a-angle',
        },
        driven: {
          id: 'driven',
          label: 'Upper power pulley',
          role: 'driven',
          center: {
            x: quantity(190, 'mm'),
            y: quantity(160, 'mm'),
            z: quantity(0, 'mm'),
          },
          axis: [0, 0, 1],
          pitchRadius: { parameter: 'driven-radius' },
          coordinate: 'driven-angle',
        },
        'guide-b': {
          id: 'guide-b',
          label: 'Guide pulley B',
          role: 'guide',
          center: {
            x: quantity(0, 'mm'),
            y: quantity(160, 'mm'),
            z: quantity(12, 'mm'),
          },
          axis: [0, 0, 1],
          pitchRadius: { parameter: 'guide-radius' },
          coordinate: 'guide-b-angle',
        },
      },
      loops: {
        'main-belt': {
          id: 'main-belt',
          label: 'Brown 003 belt loop',
          contacts: [
            { pulley: 'driver', sense: 1 },
            { pulley: 'guide-a', sense: 1 },
            { pulley: 'driven', sense: 1 },
            { pulley: 'guide-b', sense: -1 },
          ],
        },
      },
    },
  },
  coordinates: {
    'driver-angle': {
      id: 'driver-angle',
      label: 'Driver angle',
      type: 'angle',
      role: 'input',
      unit: 'rad',
      periodic: true,
    },
    'driven-angle': {
      id: 'driven-angle',
      label: 'Driven angle',
      type: 'angle',
      role: 'output',
      unit: 'rad',
      periodic: true,
    },
    'guide-a-angle': {
      id: 'guide-a-angle',
      label: 'Guide A angle',
      type: 'angle',
      role: 'internal',
      unit: 'rad',
      periodic: true,
    },
    'guide-b-angle': {
      id: 'guide-b-angle',
      label: 'Guide B angle',
      type: 'angle',
      role: 'internal',
      unit: 'rad',
      periodic: true,
    },
  },
  signals: {
    'output-angular-ratio': {
      id: 'output-angular-ratio',
      label: 'Output angular speed ratio',
      valueType: 'scalar',
      kind: 'dimensionless',
      unit: '1',
    },
    'belt-travel': {
      id: 'belt-travel',
      label: 'Signed belt travel',
      valueType: 'scalar',
      kind: 'length',
      unit: 'm',
    },
    'belt-linear-speed': {
      id: 'belt-linear-speed',
      label: 'Signed belt speed',
      valueType: 'scalar',
      kind: 'velocity',
      unit: 'm/s',
    },
  },
  configurations: {
    reference: {
      id: 'reference',
      label: 'Brown 003 reference routing',
      coordinates: {
        'driver-angle': zeroAngle,
        'driven-angle': zeroAngle,
        'guide-a-angle': zeroAngle,
        'guide-b-angle': zeroAngle,
      },
      modes: {
        'belt-loop': 'main-belt',
      },
    },
  },
  assumptions: [
    {
      id: 'ideal-belt',
      text: 'The belt is inextensible and does not slip at any pulley pitch circle.',
    },
    {
      id: 'fixed-axes',
      text: 'All four pulley centers and shaft axes are fixed in space.',
    },
    {
      id: 'passive-guides',
      text: 'The guide pulleys are passive and their angular motion is imposed only by belt speed continuity.',
    },
  ],
};
