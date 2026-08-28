import {
  SIMULATION_MODEL_SCHEMA_VERSION,
  isParameterReference,
  type FeatureRef,
  type PlanarPoseValue,
  type ScalarSource,
  type SimulationModel,
} from './model.js';
import type { Diagnostic } from './runtime.js';
import { quantityKind, type QuantityKind } from './units.js';

function invalidModel(message: string, context?: Diagnostic['context']): Diagnostic {
  const diagnostic: Diagnostic = {
    severity: 'error',
    code: 'invalid-model',
    message,
  };

  if (context !== undefined) diagnostic.context = context;
  return diagnostic;
}

function validateScalarSource(
  model: SimulationModel,
  source: ScalarSource,
  expectedKind: QuantityKind,
  location: string,
  diagnostics: Diagnostic[],
): void {
  if (isParameterReference(source)) {
    const parameter = model.parameters[source.parameter];
    if (parameter === undefined) {
      diagnostics.push(
        invalidModel(`Unknown parameter reference at ${location}`, {
          parameter: source.parameter,
        }),
      );
      return;
    }

    if (parameter.kind !== expectedKind) {
      diagnostics.push(
        invalidModel(`Parameter reference has the wrong quantity kind at ${location}`, {
          parameter: source.parameter,
          expectedKind,
          actualKind: parameter.kind,
        }),
      );
    }
    return;
  }

  const actualKind = quantityKind(source);
  if (actualKind !== expectedKind) {
    diagnostics.push(
      invalidModel(`Quantity has the wrong kind at ${location}`, {
        expectedKind,
        actualKind,
        unit: source.unit,
      }),
    );
  }
}

function validateFeatureRef(
  model: SimulationModel,
  ref: FeatureRef,
  location: string,
  diagnostics: Diagnostic[],
): void {
  const mechanical = model.systems.mechanical;
  if (mechanical === undefined) return;

  const body = mechanical.bodies[ref.body];
  if (body === undefined) {
    diagnostics.push(
      invalidModel(`Unknown body reference at ${location}`, { body: ref.body }),
    );
    return;
  }

  if (body.features[ref.feature] === undefined) {
    diagnostics.push(
      invalidModel(`Unknown feature reference at ${location}`, {
        body: ref.body,
        feature: ref.feature,
      }),
    );
  }
}

function validatePoseValue(
  pose: PlanarPoseValue,
  location: string,
  diagnostics: Diagnostic[],
): void {
  if (quantityKind(pose.x) !== 'length') {
    diagnostics.push(invalidModel(`Pose x must be a length at ${location}.x`));
  }
  if (quantityKind(pose.y) !== 'length') {
    diagnostics.push(invalidModel(`Pose y must be a length at ${location}.y`));
  }
  if (quantityKind(pose.angle) !== 'angle') {
    diagnostics.push(invalidModel(`Pose angle must be an angle at ${location}.angle`));
  }
}

export function validateSimulationModel(model: SimulationModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (model.schemaVersion !== SIMULATION_MODEL_SCHEMA_VERSION) {
    diagnostics.push(
      invalidModel('Unsupported SimulationModel schema version', {
        schemaVersion: model.schemaVersion,
      }),
    );
  }

  for (const [parameterId, parameter] of Object.entries(model.parameters)) {
    if (parameter.id !== parameterId) {
      diagnostics.push(
        invalidModel('Parameter key and id differ', {
          key: parameterId,
          id: parameter.id,
        }),
      );
    }

    if (quantityKind(parameter.default) !== parameter.kind) {
      diagnostics.push(
        invalidModel('Parameter default has the wrong quantity kind', {
          parameter: parameterId,
          expectedKind: parameter.kind,
          unit: parameter.default.unit,
        }),
      );
    }

    for (const [boundName, bound] of [
      ['min', parameter.domain?.min],
      ['max', parameter.domain?.max],
    ] as const) {
      if (bound !== undefined && quantityKind(bound) !== parameter.kind) {
        diagnostics.push(
          invalidModel('Parameter domain has the wrong quantity kind', {
            parameter: parameterId,
            bound: boundName,
            expectedKind: parameter.kind,
            unit: bound.unit,
          }),
        );
      }
    }
  }

  const mechanical = model.systems.mechanical;
  if (mechanical === undefined) {
    diagnostics.push(invalidModel('This v0 slice requires a mechanical system'));
    return diagnostics;
  }

  if (mechanical.bodies[mechanical.referenceBody] === undefined) {
    diagnostics.push(
      invalidModel('Mechanical reference body does not exist', {
        body: mechanical.referenceBody,
      }),
    );
  }

  for (const [bodyId, body] of Object.entries(mechanical.bodies)) {
    if (body.id !== bodyId) {
      diagnostics.push(
        invalidModel('Body key and id differ', { key: bodyId, id: body.id }),
      );
    }

    validateScalarSource(
      model,
      body.referencePose.x,
      'length',
      `${bodyId}.pose.x`,
      diagnostics,
    );
    validateScalarSource(
      model,
      body.referencePose.y,
      'length',
      `${bodyId}.pose.y`,
      diagnostics,
    );
    validateScalarSource(
      model,
      body.referencePose.angle,
      'angle',
      `${bodyId}.pose.angle`,
      diagnostics,
    );

    for (const [featureId, feature] of Object.entries(body.features)) {
      if (feature.id !== featureId) {
        diagnostics.push(
          invalidModel('Feature key and id differ', {
            body: bodyId,
            key: featureId,
            id: feature.id,
          }),
        );
      }

      const point =
        feature.type === 'point'
          ? feature.position
          : feature.type === 'axis'
            ? feature.origin
            : feature.center;
      validateScalarSource(
        model,
        point.x,
        'length',
        `${bodyId}.${featureId}.x`,
        diagnostics,
      );
      validateScalarSource(
        model,
        point.y,
        'length',
        `${bodyId}.${featureId}.y`,
        diagnostics,
      );

      if (feature.type === 'pulley') {
        validateScalarSource(
          model,
          feature.pitchRadius,
          'length',
          `${bodyId}.${featureId}.pitchRadius`,
          diagnostics,
        );
      }
    }
  }

  for (const [jointId, joint] of Object.entries(mechanical.joints)) {
    if (joint.id !== jointId) {
      diagnostics.push(
        invalidModel('Joint key and id differ', { key: jointId, id: joint.id }),
      );
    }

    validateFeatureRef(model, joint.parent, `${jointId}.parent`, diagnostics);
    validateFeatureRef(model, joint.child, `${jointId}.child`, diagnostics);

    if (
      joint.coordinate !== undefined &&
      model.coordinates[joint.coordinate] === undefined
    ) {
      diagnostics.push(
        invalidModel('Joint references an unknown coordinate', {
          joint: jointId,
          coordinate: joint.coordinate,
        }),
      );
    }
  }

  for (const [couplingId, coupling] of Object.entries(mechanical.couplings)) {
    if (coupling.id !== couplingId) {
      diagnostics.push(
        invalidModel('Coupling key and id differ', {
          key: couplingId,
          id: coupling.id,
        }),
      );
    }

    validateFeatureRef(model, coupling.driver, `${couplingId}.driver`, diagnostics);
    validateFeatureRef(model, coupling.driven, `${couplingId}.driven`, diagnostics);

    if (model.coordinates[coupling.inputCoordinate] === undefined) {
      diagnostics.push(
        invalidModel('Coupling references an unknown input coordinate', {
          coupling: couplingId,
          coordinate: coupling.inputCoordinate,
        }),
      );
    }

    if (model.coordinates[coupling.outputCoordinate] === undefined) {
      diagnostics.push(
        invalidModel('Coupling references an unknown output coordinate', {
          coupling: couplingId,
          coordinate: coupling.outputCoordinate,
        }),
      );
    }
  }

  for (const [coordinateId, coordinate] of Object.entries(model.coordinates)) {
    if (coordinate.id !== coordinateId) {
      diagnostics.push(
        invalidModel('Coordinate key and id differ', {
          key: coordinateId,
          id: coordinate.id,
        }),
      );
    }

    if (
      coordinate.joint !== undefined &&
      mechanical.joints[coordinate.joint] === undefined
    ) {
      diagnostics.push(
        invalidModel('Coordinate references an unknown joint', {
          coordinate: coordinateId,
          joint: coordinate.joint,
        }),
      );
    }
  }

  for (const [configurationId, configuration] of Object.entries(
    model.configurations,
  )) {
    if (configuration.id !== configurationId) {
      diagnostics.push(
        invalidModel('Configuration key and id differ', {
          key: configurationId,
          id: configuration.id,
        }),
      );
    }

    for (const coordinateId of Object.keys(configuration.coordinates)) {
      if (model.coordinates[coordinateId] === undefined) {
        diagnostics.push(
          invalidModel('Configuration references an unknown coordinate', {
            configuration: configurationId,
            coordinate: coordinateId,
          }),
        );
      }
    }

    for (const [bodyId, pose] of Object.entries(configuration.bodyPoses ?? {})) {
      if (mechanical.bodies[bodyId] === undefined) {
        diagnostics.push(
          invalidModel('Configuration references an unknown body pose', {
            configuration: configurationId,
            body: bodyId,
          }),
        );
        continue;
      }
      validatePoseValue(pose, `${configurationId}.bodyPoses.${bodyId}`, diagnostics);
    }
  }

  return diagnostics;
}
