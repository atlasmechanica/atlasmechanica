import { quantity } from '@atlasmechanica/model';
import {
  MECHANISM_LAB_SCHEMA_VERSION,
  defineMechanismLab,
  type MechanismLabDefinition,
} from './schema.js';

const RPM_TO_RAD_PER_SECOND = Math.PI * 2 / 60;

function beltDriveLab(modelId: 'foundation:belt-drive:open' | 'foundation:belt-drive:crossed') {
  const routing = modelId.endsWith(':open') ? 'open' : 'crossed';
  return defineMechanismLab({
    schemaVersion: MECHANISM_LAB_SCHEMA_VERSION,
    id: `lab:${modelId}`,
    modelId,
    subtitle: `analytic · ideal ${routing} belt`,
    modelTransformId: 'atlas.lab.vertical-belt.v0',
    sceneCompilerId: 'atlas.scene.brown-belt.v0',
    threeRendererId: 'atlas.renderer-three.belt.v0',
    sessionConfiguration: 'reference',
    views: ['2d', '3d'],
    parameterOverrides: {
      'driver-radius': quantity(45, 'mm'),
      'driven-radius': quantity(45, 'mm'),
    },
    controls: [
      {
        id: 'driver-angle',
        kind: 'coordinate',
        coordinate: 'driver-angle',
        label: 'Input angle',
        unit: 'deg',
        min: 0,
        max: 360,
        step: 1,
        initial: 0,
        queryKey: 'angle',
        interaction: {
          handle: 'input',
          mapping: { type: 'polar-angle', origin: [0, 0] },
        },
      },
      {
        id: 'center-distance',
        kind: 'parameter',
        parameter: 'center-distance',
        label: 'Center distance',
        unit: 'mm',
        min: 95,
        max: 260,
        step: 1,
        initial: 180,
        queryKey: 'center',
        interaction: {
          handle: 'parameter',
          mapping: { type: 'axis-value', axis: 'y', scale: 1000 },
        },
      },
      {
        id: 'driver-speed',
        kind: 'rate',
        coordinate: 'driver-angle',
        label: 'Driver speed',
        unit: 'rpm',
        min: 10,
        max: 120,
        step: 1,
        initial: 30,
        queryKey: 'rpm',
      },
    ],
    readouts: [
      {
        id: 'output-direction',
        label: 'Output direction',
        source: { kind: 'signal', signal: 'output-direction' },
        textMap: { same: 'Same', reversed: 'Reversed' },
      },
      {
        id: 'speed-ratio',
        label: 'Speed ratio',
        source: { kind: 'signal', signal: 'angular-ratio' },
        absolute: true,
        digits: 3,
      },
      {
        id: 'output-speed',
        label: 'Output speed',
        source: { kind: 'coordinate-rate', coordinate: 'driven-angle' },
        absolute: true,
        scale: 1 / RPM_TO_RAD_PER_SECOND,
        digits: 1,
        suffix: ' rpm',
      },
      {
        id: 'belt-speed',
        label: 'Belt speed',
        source: { kind: 'signal', signal: 'belt-linear-speed' },
        digits: 3,
        suffix: ' m/s',
      },
      {
        id: 'driver-wrap',
        label: 'Driver wrap',
        source: { kind: 'signal', signal: 'driver-wrap-angle' },
        scale: 180 / Math.PI,
        digits: 1,
        suffix: '°',
      },
      {
        id: 'belt-length',
        label: 'Ideal belt length',
        source: { kind: 'signal', signal: 'belt-length' },
        scale: 1000,
        digits: 1,
        suffix: ' mm',
      },
    ],
    animation: {
      coordinateControlId: 'driver-angle',
      rateControlId: 'driver-speed',
    },
    renderer2d: {
      keyboardParameterAxis: 'y',
      responsiveStrokeReferenceWidth: 1180,
    },
  });
}

export const openBeltDriveLab = beltDriveLab('foundation:belt-drive:open');
export const crossedBeltDriveLab = beltDriveLab('foundation:belt-drive:crossed');

export const canonicalFourBarLab = defineMechanismLab({
  schemaVersion: MECHANISM_LAB_SCHEMA_VERSION,
  id: 'lab:foundation:four-bar:crank-rocker',
  modelId: 'foundation:four-bar:crank-rocker',
  subtitle: 'analytic · canonical four-bar',
  sceneCompilerId: 'atlas.scene.four-bar.v0',
  sessionConfiguration: 'open',
  views: ['2d'],
  controls: [
    {
      id: 'driver-angle',
      kind: 'coordinate',
      coordinate: 'driver-angle',
      label: 'Crank angle',
      unit: 'deg',
      min: 0,
      max: 360,
      step: 1,
      initial: 0,
      interaction: {
        handle: 'input',
        mapping: { type: 'polar-angle', origin: [0, 0] },
      },
    },
    {
      id: 'driver-speed',
      kind: 'rate',
      coordinate: 'driver-angle',
      label: 'Crank speed',
      unit: 'rpm',
      min: 5,
      max: 90,
      step: 1,
      initial: 30,
    },
    {
      id: 'ground-length',
      kind: 'parameter',
      parameter: 'ground-length',
      unit: 'mm',
      min: 70,
      max: 130,
      step: 1,
      initial: 100,
    },
  ],
  readouts: [
    {
      id: 'coupler-angle',
      source: { kind: 'signal', signal: 'coupler-angle' },
      scale: 180 / Math.PI,
      digits: 1,
      suffix: '°',
    },
    {
      id: 'rocker-angle',
      source: { kind: 'signal', signal: 'rocker-angle' },
      scale: 180 / Math.PI,
      digits: 1,
      suffix: '°',
    },
    {
      id: 'rocker-speed',
      label: 'Rocker speed',
      source: { kind: 'signal', signal: 'rocker-angular-velocity' },
      scale: 1 / RPM_TO_RAD_PER_SECOND,
      digits: 1,
      suffix: ' rpm',
    },
  ],
  animation: {
    coordinateControlId: 'driver-angle',
    rateControlId: 'driver-speed',
  },
  renderer2d: {
    responsiveStrokeReferenceWidth: 640,
  },
});

export const mechanismLabDefinitions: readonly MechanismLabDefinition[] = Object.freeze([
  openBeltDriveLab,
  crossedBeltDriveLab,
  canonicalFourBarLab,
]);
