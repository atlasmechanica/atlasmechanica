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
export type FixedAxisPulleyId = string;
export type BeltLoopId = string;

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

export interface LocalPoint3DDefinition extends LocalPoint2DDefinition {
  z: ScalarSource;
}

export interface PlanarPoseDefinition extends LocalPoint2DDefinition {
  angle: ScalarSource;
}

/** Concrete authored pose used to seed a reproducible physical configuration. */
export interface PlanarPoseValue {
  x: QuantityValue;
  y: QuantityValue;
  angle: QuantityValue;
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

/**
 * A pulley whose center and axis are fixed in 3D space. Rotation is represented
 * by its model angle coordinate; this is intentionally narrower than a general
 * spatial rigid body.
 */
export interface FixedAxisPulleyDefinition {
  id: FixedAxisPulleyId;
  label: string;
  role: 'driver' | 'driven' | 'guide';
  center: LocalPoint3DDefinition;
  /** Fixed shaft-axis direction. It must be finite and non-zero. */
  axis: readonly [number, number, number];
  pitchRadius: ScalarSource;
  /** Physical pulley-face width measured along the shaft axis. */
  faceWidth: ScalarSource;
  coordinate: CoordinateId;
}

/**
 * One contact in loop-travel order. `sense` declares whether positive pulley
 * rotation moves its pitch surface with (+1) or against (-1) that loop travel.
 * It is an authored routing/assembly semantic, analogous to open/crossed
 * routing; it does not by itself prove that a realizable tangent/contact path
 * exists for the authored centers, axes, radii, and pulley widths.
 */
export interface FixedAxisBeltContactDefinition {
  pulley: FixedAxisPulleyId;
  sense: 1 | -1;
}

export interface FixedAxisBeltLoopDefinition {
  id: BeltLoopId;
  label?: string;
  /** Physical belt width used to validate axial tracking across pulley faces. */
  beltWidth: ScalarSource;
  contacts: readonly FixedAxisBeltContactDefinition[];
}

/**
 * Fixed-axis spatial belt transmission semantics. Geometry-capable simulation
 * adapters must independently establish a realizable route before advertising
 * kinematic capabilities for one of these systems.
 */
export interface FixedAxisBeltSystemDefinition {
  dimensionality: 'spatial-fixed-axis';
  pulleys: Record<FixedAxisPulleyId, FixedAxisPulleyDefinition>;
  loops: Record<BeltLoopId, FixedAxisBeltLoopDefinition>;
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
  coordinates: Partial<Record<CoordinateId, QuantityValue>>;
  /**
   * Optional concrete body poses used as solver seeds for assembly branches.
   * These are physical reference states, not animation keyframes.
   */
  bodyPoses?: Partial<Record<BodyId, PlanarPoseValue>>;
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
    fixedAxisBelt?: FixedAxisBeltSystemDefinition;
  };
  coordinates: Record<CoordinateId, CoordinateDefinition>;
  signals: Record<SignalId, SignalDefinition>;
  configurations: Record<ConfigurationId, ReferenceConfiguration>;
  assumptions: Assumption[];
}
