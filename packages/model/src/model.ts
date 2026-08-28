import type { QuantityKind, QuantityValue, UnitCode } from './units.js';

export const SIMULATION_MODEL_SCHEMA_VERSION = '0.1' as const;

export type ModelId = string;
export type SubjectId = string;
export type VariantId = string;
export type ParameterId = string;
export type BodyId = string;
export type FeatureId = string;
export type JointId = string;
export type CouplingId = string;
export type CoordinateId = string;
export type SignalId = string;
export type ConfigurationId = string;
export type AssumptionId = string;

export interface ParameterReference {
  parameter: ParameterId;
}

export type ScalarSource = QuantityValue | ParameterReference;

export function isParameterReference(
  source: ScalarSource,
): source is ParameterReference {
  return 'parameter' in source;
}

export interface LocalPoint2DDefinition {
  x: ScalarSource;
  y: ScalarSource;
}

export interface PlanarPoseDefinition extends LocalPoint2DDefinition {
  angle: ScalarSource;
}

export interface ParameterDefinition {
  id: ParameterId;
  label: string;
  kind: QuantityKind;
  default: QuantityValue;
  domain?: {
    min?: QuantityValue;
    max?: QuantityValue;
  };
}

export interface PointFeatureDefinition {
  type: 'point';
  id: FeatureId;
  label?: string;
  position: LocalPoint2DDefinition;
}

export interface AxisFeatureDefinition {
  type: 'axis';
  id: FeatureId;
  label?: string;
  origin: LocalPoint2DDefinition;
  direction: readonly [number, number, number];
}

export interface PulleyFeatureDefinition {
  type: 'pulley';
  id: FeatureId;
  label?: string;
  center: LocalPoint2DDefinition;
  pitchRadius: ScalarSource;
}

export type MechanicalFeatureDefinition =
  | PointFeatureDefinition
  | AxisFeatureDefinition
  | PulleyFeatureDefinition;

export interface RigidBodyDefinition {
  id: BodyId;
  label: string;
  referencePose: PlanarPoseDefinition;
  features: Record<FeatureId, MechanicalFeatureDefinition>;
}

export interface FeatureRef {
  body: BodyId;
  feature: FeatureId;
}

export interface RevoluteJointDefinition {
  type: 'revolute';
  id: JointId;
  label?: string;
  parent: FeatureRef;
  child: FeatureRef;
  coordinate?: CoordinateId;
}

export type JointDefinition = RevoluteJointDefinition;

export interface BeltCouplingDefinition {
  type: 'belt';
  id: CouplingId;
  label?: string;
  driver: FeatureRef;
  driven: FeatureRef;
  routing: 'open' | 'crossed';
  inputCoordinate: CoordinateId;
  outputCoordinate: CoordinateId;
}

export type CouplingDefinition = BeltCouplingDefinition;

export interface MechanicalSystemDefinition {
  dimensionality: 'planar';
  referenceBody: BodyId;
  bodies: Record<BodyId, RigidBodyDefinition>;
  joints: Record<JointId, JointDefinition>;
  couplings: Record<CouplingId, CouplingDefinition>;
}

export interface CoordinateDefinition {
  id: CoordinateId;
  label: string;
  type: 'angle';
  role: 'input' | 'output' | 'internal';
  unit: 'rad';
  periodic: boolean;
  joint?: JointId;
}

export interface SignalDefinition {
  id: SignalId;
  label: string;
  valueType: 'scalar' | 'vector2' | 'text' | 'boolean';
  kind?: QuantityKind;
  unit?: UnitCode;
}

export interface ReferenceConfiguration {
  id: ConfigurationId;
  label: string;
  coordinates: Record<CoordinateId, QuantityValue>;
  modes?: Record<string, string | boolean | number>;
}

export interface Assumption {
  id: AssumptionId;
  text: string;
}

export interface SimulationModel {
  schemaVersion: typeof SIMULATION_MODEL_SCHEMA_VERSION;
  id: ModelId;
  subject: SubjectId;
  variant?: VariantId;
  parameters: Record<ParameterId, ParameterDefinition>;
  systems: {
    mechanical?: MechanicalSystemDefinition;
  };
  coordinates: Record<CoordinateId, CoordinateDefinition>;
  signals: Record<SignalId, SignalDefinition>;
  configurations: Record<ConfigurationId, ReferenceConfiguration>;
  assumptions: Assumption[];
}
