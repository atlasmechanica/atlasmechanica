import {
  analyticFourBarAdapter,
  canonicalFourBarModel,
} from '@atlasmechanica/kinematics';
import { fourBarSceneCompiler } from '@atlasmechanica/scene/compilers';
import type { MechanismLabFamily } from '../family.js';
import {
  MECHANISM_LAB_SCHEMA_VERSION,
  defineMechanismLab,
} from '../schema.js';

const RPM_TO_RAD_PER_SECOND = Math.PI * 2 / 60;

export const canonicalFourBarLab = defineMechanismLab({
  schemaVersion: MECHANISM_LAB_SCHEMA_VERSION,
  id: 'lab:foundation:four-bar:crank-rocker:canonical',
  modelId: 'foundation:four-bar:crank-rocker',
  defaultForModel: true,
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

export const fourBarLabFamily: MechanismLabFamily = Object.freeze({
  definitions: Object.freeze([canonicalFourBarLab]),
  models: Object.freeze([canonicalFourBarModel]),
  adapters: Object.freeze([analyticFourBarAdapter]),
  sceneCompilers: Object.freeze([fourBarSceneCompiler]),
});
