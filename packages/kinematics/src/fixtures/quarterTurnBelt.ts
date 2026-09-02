import {
  SIMULATION_MODEL_SCHEMA_VERSION,
  quantity,
  type SimulationModel,
} from '@atlasmechanica/model';

const zero = quantity(0, 'mm');
const zeroAngle = quantity(0, 'rad');

/**
 * Atlas reference geometry for the Brown 003 family.
 *
 * Brown specifies the topology (perpendicular power shafts and two guide
 * pulleys side by side, one for each belt leaf) but does not dimension the
 * hidden depth or pulley faces. These dimensions are therefore editorial
 * reference values, constructed to satisfy the historical middle-plane
 * delivery rule used for non-parallel flat-belt transmissions.
 *
 * The lower power pulley axis lies along +X. The upper power pulley and the
 * coaxial guide pair lie on +Z axes. The guide middle planes sit one driver
 * radius to either side of the driver's center plane, and their radial center
 * is displaced by one guide radius in +X. That construction admits the two
 * vertical guide spans visible in Brown's plate. Finite pulley-face widths let
 * the remaining belt portions track laterally between the guide planes and the
 * upper power pulley's middle plane.
 *
 * Historical flat-belt descriptions of this one-direction arrangement also
 * describe the belt moving across the pulley face. Atlas therefore models the
 * ideal transmission law as circumferential traction continuity only; lateral
 * face tracking is explicit slip and is not part of the ωr ratio constraint.
 *
 * These are Atlas reference dimensions, not measurements inferred from Brown.
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
          faceWidth: quantity(100, 'mm'),
          coordinate: 'driver-angle',
        },
        'guide-a': {
          id: 'guide-a',
          label: 'Guide pulley A',
          role: 'guide',
          center: {
            x: quantity(20, 'mm'),
            y: quantity(160, 'mm'),
            z: quantity(-45, 'mm'),
          },
          axis: [0, 0, 1],
          pitchRadius: { parameter: 'guide-radius' },
          faceWidth: quantity(110, 'mm'),
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
          faceWidth: quantity(110, 'mm'),
          coordinate: 'driven-angle',
        },
        'guide-b': {
          id: 'guide-b',
          label: 'Guide pulley B',
          role: 'guide',
          center: {
            x: quantity(20, 'mm'),
            y: quantity(160, 'mm'),
            z: quantity(45, 'mm'),
          },
          axis: [0, 0, 1],
          pitchRadius: { parameter: 'guide-radius' },
          faceWidth: quantity(30, 'mm'),
          coordinate: 'guide-b-angle',
        },
      },
      loops: {
        'main-belt': {
          id: 'main-belt',
          label: 'Brown 003 belt loop',
          beltWidth: quantity(10, 'mm'),
          contacts: [
            { pulley: 'driver', sense: 1 },
            { pulley: 'guide-a', sense: 1 },
            { pulley: 'driven', sense: 1 },
            { pulley: 'guide-b', sense: 1 },
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
      id: 'ideal-circumferential-traction',
      text: 'The belt is inextensible and has no circumferential slip at each pulley pitch surface, so the ideal tangential belt speed equals radius times angular speed.',
    },
    {
      id: 'lateral-tracking-slip',
      text: 'Where the Brown 003 route changes axial position across a pulley face, that motion is lateral tracking slip and is not constrained by the ideal circumferential speed-ratio law.',
    },
    {
      id: 'fixed-axes',
      text: 'All four pulley centers and shaft axes are fixed in space.',
    },
    {
      id: 'passive-guides',
      text: 'The guide pulleys are passive and their angular motion is imposed by ideal circumferential belt-speed continuity.',
    },
  ],
};
