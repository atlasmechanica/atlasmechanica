import {
  SIMULATION_MODEL_SCHEMA_VERSION,
  quantity,
  type SimulationModel,
} from '@atlasmechanica/model';

const zeroLength = quantity(0, 'mm');
const zeroAngle = quantity(0, 'rad');

export function createBeltDriveModel(
  routing: 'open' | 'crossed',
): SimulationModel {
  return {
    schemaVersion: SIMULATION_MODEL_SCHEMA_VERSION,
    id: `foundation:belt-drive:${routing}`,
    subject: 'belt-drive',
    variant: `${routing}-belt-drive`,
    parameters: {
      'driver-radius': {
        id: 'driver-radius',
        label: 'Driver pulley pitch radius',
        kind: 'length',
        default: quantity(30, 'mm'),
        domain: { min: quantity(1, 'mm') },
      },
      'driven-radius': {
        id: 'driven-radius',
        label: 'Driven pulley pitch radius',
        kind: 'length',
        default: quantity(60, 'mm'),
        domain: { min: quantity(1, 'mm') },
      },
      'center-distance': {
        id: 'center-distance',
        label: 'Pulley center distance',
        kind: 'length',
        default: quantity(180, 'mm'),
        domain: { min: quantity(1, 'mm') },
      },
    },
    systems: {
      mechanical: {
        dimensionality: 'planar',
        referenceBody: 'ground',
        bodies: {
          ground: {
            id: 'ground',
            label: 'Ground',
            referencePose: { x: zeroLength, y: zeroLength, angle: zeroAngle },
            features: {
              'driver-axis': {
                type: 'axis',
                id: 'driver-axis',
                label: 'Driver shaft axis',
                origin: { x: zeroLength, y: zeroLength },
                direction: [0, 0, 1],
              },
              'driven-axis': {
                type: 'axis',
                id: 'driven-axis',
                label: 'Driven shaft axis',
                origin: {
                  x: { parameter: 'center-distance' },
                  y: zeroLength,
                },
                direction: [0, 0, 1],
              },
            },
          },
          driver: {
            id: 'driver',
            label: 'Driver pulley',
            referencePose: { x: zeroLength, y: zeroLength, angle: zeroAngle },
            features: {
              shaft: {
                type: 'axis',
                id: 'shaft',
                origin: { x: zeroLength, y: zeroLength },
                direction: [0, 0, 1],
              },
              pulley: {
                type: 'pulley',
                id: 'pulley',
                center: { x: zeroLength, y: zeroLength },
                pitchRadius: { parameter: 'driver-radius' },
              },
            },
          },
          driven: {
            id: 'driven',
            label: 'Driven pulley',
            referencePose: {
              x: { parameter: 'center-distance' },
              y: zeroLength,
              angle: zeroAngle,
            },
            features: {
              shaft: {
                type: 'axis',
                id: 'shaft',
                origin: { x: zeroLength, y: zeroLength },
                direction: [0, 0, 1],
              },
              pulley: {
                type: 'pulley',
                id: 'pulley',
                center: { x: zeroLength, y: zeroLength },
                pitchRadius: { parameter: 'driven-radius' },
              },
            },
          },
        },
        joints: {
          'driver-bearing': {
            type: 'revolute',
            id: 'driver-bearing',
            label: 'Driver bearing',
            parent: { body: 'ground', feature: 'driver-axis' },
            child: { body: 'driver', feature: 'shaft' },
            coordinate: 'driver-angle',
          },
          'driven-bearing': {
            type: 'revolute',
            id: 'driven-bearing',
            label: 'Driven bearing',
            parent: { body: 'ground', feature: 'driven-axis' },
            child: { body: 'driven', feature: 'shaft' },
            coordinate: 'driven-angle',
          },
        },
        couplings: {
          belt: {
            type: 'belt',
            id: 'belt',
            label: `${routing === 'open' ? 'Open' : 'Crossed'} belt`,
            driver: { body: 'driver', feature: 'pulley' },
            driven: { body: 'driven', feature: 'pulley' },
            routing,
            inputCoordinate: 'driver-angle',
            outputCoordinate: 'driven-angle',
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
        joint: 'driver-bearing',
      },
      'driven-angle': {
        id: 'driven-angle',
        label: 'Driven angle',
        type: 'angle',
        role: 'output',
        unit: 'rad',
        periodic: true,
        joint: 'driven-bearing',
      },
    },
    signals: {
      'angular-ratio': {
        id: 'angular-ratio',
        label: 'Signed angular ratio',
        valueType: 'scalar',
        kind: 'dimensionless',
        unit: '1',
      },
      'output-direction': {
        id: 'output-direction',
        label: 'Output direction',
        valueType: 'text',
      },
      'belt-linear-speed': {
        id: 'belt-linear-speed',
        label: 'Belt linear speed',
        valueType: 'scalar',
        kind: 'velocity',
        unit: 'm/s',
      },
      'belt-travel': {
        id: 'belt-travel',
        label: 'Belt travel from reference configuration',
        valueType: 'scalar',
        kind: 'length',
        unit: 'm',
      },
      'straight-span-length': {
        id: 'straight-span-length',
        label: 'Straight span length',
        valueType: 'scalar',
        kind: 'length',
        unit: 'm',
      },
      'driver-wrap-angle': {
        id: 'driver-wrap-angle',
        label: 'Driver wrap angle',
        valueType: 'scalar',
        kind: 'angle',
        unit: 'rad',
      },
      'driven-wrap-angle': {
        id: 'driven-wrap-angle',
        label: 'Driven wrap angle',
        valueType: 'scalar',
        kind: 'angle',
        unit: 'rad',
      },
      'belt-length': {
        id: 'belt-length',
        label: 'Ideal pitch-line belt length',
        valueType: 'scalar',
        kind: 'length',
        unit: 'm',
      },
      'validity-margin': {
        id: 'validity-margin',
        label: 'Geometric validity margin',
        valueType: 'scalar',
        kind: 'length',
        unit: 'm',
      },
      'driver-contact-a': {
        id: 'driver-contact-a',
        label: 'Driver contact point A',
        valueType: 'vector2',
        kind: 'length',
        unit: 'm',
      },
      'driven-contact-a': {
        id: 'driven-contact-a',
        label: 'Driven contact point A',
        valueType: 'vector2',
        kind: 'length',
        unit: 'm',
      },
      'driver-contact-b': {
        id: 'driver-contact-b',
        label: 'Driver contact point B',
        valueType: 'vector2',
        kind: 'length',
        unit: 'm',
      },
      'driven-contact-b': {
        id: 'driven-contact-b',
        label: 'Driven contact point B',
        valueType: 'vector2',
        kind: 'length',
        unit: 'm',
      },
    },
    configurations: {
      reference: {
        id: 'reference',
        label: 'Aligned reference phase',
        coordinates: {
          'driver-angle': quantity(0, 'rad'),
          'driven-angle': quantity(0, 'rad'),
        },
      },
    },
    assumptions: [
      {
        id: 'ideal-belt',
        text: 'The belt is massless, inextensible and follows the pulley pitch circles.',
      },
      {
        id: 'no-slip',
        text: 'There is no slip between belt and pulley pitch surfaces.',
      },
      {
        id: 'planar-fixed-centers',
        text: 'Pulley shaft centers are fixed and coplanar.',
      },
    ],
  };
}

export const openBeltDriveModel = createBeltDriveModel('open');
export const crossedBeltDriveModel = createBeltDriveModel('crossed');
