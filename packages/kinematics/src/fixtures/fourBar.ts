import {
  SIMULATION_MODEL_SCHEMA_VERSION,
  quantity,
  type SimulationModel,
} from '@atlasmechanica/model';

const zeroLength = quantity(0, 'mm');
const zeroAngle = quantity(0, 'rad');

const openCouplerAngleDeg = 55.15009542095352;
const openRockerAngleDeg = 110.30019084190704;

export const canonicalFourBarModel: SimulationModel = {
  schemaVersion: SIMULATION_MODEL_SCHEMA_VERSION,
  id: 'foundation:four-bar:crank-rocker',
  subject: 'four-bar-linkage',
  variant: 'grashof-crank-rocker',
  parameters: {
    'ground-length': {
      id: 'ground-length',
      label: 'Ground link length',
      kind: 'length',
      default: quantity(100, 'mm'),
      domain: { min: quantity(1, 'mm') },
    },
    'crank-length': {
      id: 'crank-length',
      label: 'Crank length',
      kind: 'length',
      default: quantity(30, 'mm'),
      domain: { min: quantity(1, 'mm') },
    },
    'coupler-length': {
      id: 'coupler-length',
      label: 'Coupler length',
      kind: 'length',
      default: quantity(80, 'mm'),
      domain: { min: quantity(1, 'mm') },
    },
    'rocker-length': {
      id: 'rocker-length',
      label: 'Rocker length',
      kind: 'length',
      default: quantity(70, 'mm'),
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
            O2: {
              type: 'point',
              id: 'O2',
              label: 'Input ground pivot O2',
              position: { x: zeroLength, y: zeroLength },
            },
            O4: {
              type: 'point',
              id: 'O4',
              label: 'Output ground pivot O4',
              position: {
                x: { parameter: 'ground-length' },
                y: zeroLength,
              },
            },
          },
        },
        crank: {
          id: 'crank',
          label: 'Crank',
          referencePose: { x: zeroLength, y: zeroLength, angle: zeroAngle },
          features: {
            O2: {
              type: 'point',
              id: 'O2',
              position: { x: zeroLength, y: zeroLength },
            },
            A: {
              type: 'point',
              id: 'A',
              position: {
                x: { parameter: 'crank-length' },
                y: zeroLength,
              },
            },
          },
        },
        coupler: {
          id: 'coupler',
          label: 'Coupler',
          referencePose: {
            x: quantity(30, 'mm'),
            y: zeroLength,
            angle: quantity(openCouplerAngleDeg, 'deg'),
          },
          features: {
            A: {
              type: 'point',
              id: 'A',
              position: { x: zeroLength, y: zeroLength },
            },
            B: {
              type: 'point',
              id: 'B',
              position: {
                x: { parameter: 'coupler-length' },
                y: zeroLength,
              },
            },
            tracer: {
              type: 'point',
              id: 'tracer',
              label: 'Body-fixed coupler point',
              position: { x: quantity(40, 'mm'), y: quantity(20, 'mm') },
            },
          },
        },
        rocker: {
          id: 'rocker',
          label: 'Rocker',
          referencePose: {
            x: quantity(100, 'mm'),
            y: zeroLength,
            angle: quantity(openRockerAngleDeg, 'deg'),
          },
          features: {
            O4: {
              type: 'point',
              id: 'O4',
              position: { x: zeroLength, y: zeroLength },
            },
            B: {
              type: 'point',
              id: 'B',
              position: {
                x: { parameter: 'rocker-length' },
                y: zeroLength,
              },
            },
          },
        },
      },
      joints: {
        O2: {
          type: 'revolute',
          id: 'O2',
          label: 'Input pivot O2',
          parent: { body: 'ground', feature: 'O2' },
          child: { body: 'crank', feature: 'O2' },
          coordinate: 'driver-angle',
        },
        A: {
          type: 'revolute',
          id: 'A',
          label: 'Crank-coupler pivot A',
          parent: { body: 'crank', feature: 'A' },
          child: { body: 'coupler', feature: 'A' },
        },
        B: {
          type: 'revolute',
          id: 'B',
          label: 'Coupler-rocker pivot B',
          parent: { body: 'coupler', feature: 'B' },
          child: { body: 'rocker', feature: 'B' },
        },
        O4: {
          type: 'revolute',
          id: 'O4',
          label: 'Output ground pivot O4',
          parent: { body: 'ground', feature: 'O4' },
          child: { body: 'rocker', feature: 'O4' },
        },
      },
      couplings: {},
    },
  },
  coordinates: {
    'driver-angle': {
      id: 'driver-angle',
      label: 'Crank input angle',
      type: 'angle',
      role: 'input',
      unit: 'rad',
      periodic: true,
      joint: 'O2',
    },
  },
  signals: {
    'point-a-position': {
      id: 'point-a-position',
      label: 'Joint A position',
      valueType: 'vector2',
      kind: 'length',
      unit: 'm',
    },
    'point-b-position': {
      id: 'point-b-position',
      label: 'Joint B position',
      valueType: 'vector2',
      kind: 'length',
      unit: 'm',
    },
    'coupler-point-position': {
      id: 'coupler-point-position',
      label: 'Coupler tracer position',
      valueType: 'vector2',
      kind: 'length',
      unit: 'm',
    },
    'coupler-point-velocity': {
      id: 'coupler-point-velocity',
      label: 'Coupler tracer velocity',
      valueType: 'vector2',
      kind: 'velocity',
      unit: 'm/s',
    },
    'coupler-point-acceleration': {
      id: 'coupler-point-acceleration',
      label: 'Coupler tracer acceleration',
      valueType: 'vector2',
      kind: 'acceleration',
      unit: 'm/s^2',
    },
    'coupler-angle': {
      id: 'coupler-angle',
      label: 'Coupler angle',
      valueType: 'scalar',
      kind: 'angle',
      unit: 'rad',
    },
    'rocker-angle': {
      id: 'rocker-angle',
      label: 'Rocker angle',
      valueType: 'scalar',
      kind: 'angle',
      unit: 'rad',
    },
    'coupler-angular-velocity': {
      id: 'coupler-angular-velocity',
      label: 'Coupler angular velocity',
      valueType: 'scalar',
      kind: 'angular-velocity',
      unit: 'rad/s',
    },
    'rocker-angular-velocity': {
      id: 'rocker-angular-velocity',
      label: 'Rocker angular velocity',
      valueType: 'scalar',
      kind: 'angular-velocity',
      unit: 'rad/s',
    },
    'coupler-angular-acceleration': {
      id: 'coupler-angular-acceleration',
      label: 'Coupler angular acceleration',
      valueType: 'scalar',
      kind: 'angular-acceleration',
      unit: 'rad/s^2',
    },
    'rocker-angular-acceleration': {
      id: 'rocker-angular-acceleration',
      label: 'Rocker angular acceleration',
      valueType: 'scalar',
      kind: 'angular-acceleration',
      unit: 'rad/s^2',
    },
    'assembly-branch': {
      id: 'assembly-branch',
      label: 'Assembly branch',
      valueType: 'text',
    },
  },
  configurations: {
    open: {
      id: 'open',
      label: 'Open assembly',
      coordinates: { 'driver-angle': quantity(0, 'rad') },
      bodyPoses: {
        ground: { x: zeroLength, y: zeroLength, angle: zeroAngle },
        crank: { x: zeroLength, y: zeroLength, angle: zeroAngle },
        coupler: {
          x: quantity(30, 'mm'),
          y: zeroLength,
          angle: quantity(openCouplerAngleDeg, 'deg'),
        },
        rocker: {
          x: quantity(100, 'mm'),
          y: zeroLength,
          angle: quantity(openRockerAngleDeg, 'deg'),
        },
      },
      modes: { assembly: 'open' },
    },
    crossed: {
      id: 'crossed',
      label: 'Crossed assembly',
      coordinates: { 'driver-angle': quantity(0, 'rad') },
      bodyPoses: {
        ground: { x: zeroLength, y: zeroLength, angle: zeroAngle },
        crank: { x: zeroLength, y: zeroLength, angle: zeroAngle },
        coupler: {
          x: quantity(30, 'mm'),
          y: zeroLength,
          angle: quantity(-openCouplerAngleDeg, 'deg'),
        },
        rocker: {
          x: quantity(100, 'mm'),
          y: zeroLength,
          angle: quantity(-openRockerAngleDeg, 'deg'),
        },
      },
      modes: { assembly: 'crossed' },
    },
  },
  assumptions: [
    {
      id: 'rigid-links',
      text: 'All links are rigid and all revolute joints are ideal with zero clearance.',
    },
    {
      id: 'planar-motion',
      text: 'All joint axes are parallel and the linkage remains planar.',
    },
  ],
};
