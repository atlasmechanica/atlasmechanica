import type { ConfigurationId, SimulationModel, Vector2 } from '@atlasmechanica/model';
import {
  branchSign,
  configurationBranchSign,
  discoverFourBar,
  getPointFeature,
  poseSeed,
  resolveParameters,
  resolvePoint,
  resolvePose,
} from './fourBarTopology.js';
import { magnitude2, subtract2, worldPoint2 } from './planarRigidBody.js';

export interface FourBarConstraintConfiguration {
  branchSign: number;
  seedB: Vector2;
  referenceInput: number;
}

/**
 * Portable point-level execution IR for generic planar constraint solvers.
 * This is derived from SimulationModel and must never be authored as corpus truth.
 */
export interface FourBarConstraintPlan {
  schemaVersion: 1;
  model: string;
  inputCoordinate: string;
  geometry: {
    inputGroundPivot: Vector2;
    outputGroundPivot: Vector2;
    crankVector: Vector2;
    couplerLength: number;
    rockerLength: number;
  };
  configurations: Record<ConfigurationId, FourBarConstraintConfiguration>;
}

export function compileFourBarConstraintPlan(
  model: SimulationModel,
): FourBarConstraintPlan {
  const context = discoverFourBar(model);
  if (context === undefined) {
    throw new TypeError('Model is not a supported four-bar topology');
  }

  const mechanical = model.systems.mechanical;
  if (mechanical === undefined) {
    throw new TypeError('Four-bar model has no mechanical system');
  }

  const parameters = resolveParameters(model, {});
  const ground = mechanical.bodies[context.groundBody];
  const crank = mechanical.bodies[context.crankBody];
  const coupler = mechanical.bodies[context.couplerBody];
  const rocker = mechanical.bodies[context.rockerBody];
  if (
    ground === undefined ||
    crank === undefined ||
    coupler === undefined ||
    rocker === undefined
  ) {
    throw new TypeError('Four-bar topology references missing bodies');
  }

  const groundInput = getPointFeature(model, context.groundInput);
  const groundOutput = getPointFeature(model, context.groundOutput);
  const crankInput = getPointFeature(model, context.crankInput);
  const crankCoupler = getPointFeature(model, context.crankCoupler);
  const couplerCrank = getPointFeature(model, context.couplerCrank);
  const couplerRocker = getPointFeature(model, context.couplerRocker);
  const rockerGround = getPointFeature(model, context.rockerGround);
  const rockerCoupler = getPointFeature(model, context.rockerCoupler);
  if (
    groundInput === undefined ||
    groundOutput === undefined ||
    crankInput === undefined ||
    crankCoupler === undefined ||
    couplerCrank === undefined ||
    couplerRocker === undefined ||
    rockerGround === undefined ||
    rockerCoupler === undefined
  ) {
    throw new TypeError('Four-bar topology is missing point features');
  }

  const groundPose = resolvePose(ground, parameters);
  const inputGroundPivot = worldPoint2(
    groundPose,
    resolvePoint(groundInput, parameters),
  );
  const outputGroundPivot = worldPoint2(
    groundPose,
    resolvePoint(groundOutput, parameters),
  );
  const crankVector = subtract2(
    resolvePoint(crankCoupler, parameters),
    resolvePoint(crankInput, parameters),
  );
  const couplerLength = magnitude2(
    subtract2(
      resolvePoint(couplerRocker, parameters),
      resolvePoint(couplerCrank, parameters),
    ),
  );
  const rockerLength = magnitude2(
    subtract2(
      resolvePoint(rockerCoupler, parameters),
      resolvePoint(rockerGround, parameters),
    ),
  );

  const configurations: FourBarConstraintPlan['configurations'] = {};
  for (const [configurationId, configuration] of Object.entries(
    model.configurations,
  )) {
    const couplerPose = poseSeed(
      model,
      configurationId,
      context.couplerBody,
      parameters,
    );
    if (couplerPose === undefined) {
      throw new TypeError(`Configuration ${configurationId} is missing a coupler pose seed`);
    }

    const seedB = worldPoint2(
      couplerPose,
      resolvePoint(couplerRocker, parameters),
    );
    const expectedSign = configurationBranchSign(
      model,
      configurationId,
      context,
    );

    if (
      branchSign(inputGroundPivot, outputGroundPivot, seedB) !== expectedSign &&
      configuration.coordinates[context.inputCoordinate]?.value === 0
    ) {
      throw new TypeError(`Configuration ${configurationId} has inconsistent branch seed`);
    }

    configurations[configurationId] = {
      branchSign: expectedSign,
      seedB,
      referenceInput:
        configuration.coordinates[context.inputCoordinate]?.value ?? 0,
    };
  }

  return {
    schemaVersion: 1,
    model: model.id,
    inputCoordinate: context.inputCoordinate,
    geometry: {
      inputGroundPivot,
      outputGroundPivot,
      crankVector,
      couplerLength,
      rockerLength,
    },
    configurations,
  };
}
