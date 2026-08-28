import type {
  BodyId,
  ConfigurationId,
  CoordinateId,
  ModelId,
  ParameterId,
  SignalId,
  SimulationModel,
} from './model.js';
import type {
  CanonicalQuantityValue,
  CanonicalUnitCode,
  QuantityValue,
} from './units.js';

/** Runtime poses are normalized to meters and radians. */
export interface Pose2D {
  x: number;
  y: number;
  angle: number;
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface CoordinateState {
  position: CanonicalQuantityValue;
  velocity?: CanonicalQuantityValue;
  acceleration?: CanonicalQuantityValue;
}

export interface BodyState {
  pose: Pose2D;
  /** Radians per second. */
  angularVelocity?: number;
  /** Radians per second squared. */
  angularAcceleration?: number;
}

export interface ScalarSignalValue {
  type: 'scalar';
  value: CanonicalQuantityValue;
}

export interface Vector2SignalValue {
  type: 'vector2';
  value: Vector2;
  unit: CanonicalUnitCode;
}

export interface TextSignalValue {
  type: 'text';
  value: string;
}

export interface BooleanSignalValue {
  type: 'boolean';
  value: boolean;
}

export type SignalValue =
  | ScalarSignalValue
  | Vector2SignalValue
  | TextSignalValue
  | BooleanSignalValue;

export type DiagnosticCode =
  | 'invalid-model'
  | 'invalid-input'
  | 'invalid-geometry'
  | 'physical-singularity'
  | 'formulation-singularity'
  | 'branch-ambiguity'
  | 'contact-transition'
  | 'solver-nonconvergence'
  | 'unsupported-model'
  | 'missing-input';

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: DiagnosticCode;
  message: string;
  context?: Record<string, string | number | boolean>;
}

export interface ModelState {
  model: ModelId;
  configuration?: ConfigurationId;
  time?: CanonicalQuantityValue;
  coordinates: Partial<Record<CoordinateId, CoordinateState>>;
  bodies: Partial<Record<BodyId, BodyState>>;
  signals: Partial<Record<SignalId, SignalValue>>;
  modes: Record<string, string | boolean | number>;
  diagnostics: Diagnostic[];
}

export type PositionCapability = 'exact' | 'numeric' | 'unavailable';
export type DerivativeCapability = 'analytic' | 'numeric' | 'unavailable';

export interface ModelCapabilities {
  position: PositionCapability;
  velocity: DerivativeCapability;
  acceleration: DerivativeCapability;
  force: 'analytic' | 'numeric' | 'unavailable';
  dynamics: 'time-domain' | 'equilibrium-only' | 'unavailable';
  events: 'exact' | 'numeric' | 'unavailable';
}

export interface EvaluationRequest {
  coordinates?: Partial<Record<CoordinateId, QuantityValue>>;
  rates?: Partial<Record<CoordinateId, QuantityValue>>;
  accelerations?: Partial<Record<CoordinateId, QuantityValue>>;
  parameters?: Partial<Record<ParameterId, QuantityValue>>;
}

export interface SessionOptions {
  configuration?: ConfigurationId;
  parameters?: Partial<Record<ParameterId, QuantityValue>>;
}

export interface SessionSnapshot {
  configuration: ConfigurationId;
  parameters: Partial<Record<ParameterId, QuantityValue>>;
  modes: Record<string, string | boolean | number>;
}

export interface ModelSession {
  evaluate(request?: EvaluationRequest): ModelState;
  reset(configuration?: ConfigurationId): void;
  snapshot(): SessionSnapshot;
}

export interface CompiledModel {
  readonly model: SimulationModel;
  readonly capabilities: ModelCapabilities;
  createSession(options?: SessionOptions): ModelSession;
}

export interface SimulationAdapter {
  readonly id: string;
  supports(model: SimulationModel): boolean;
  compile(model: SimulationModel): CompiledModel;
}

export function hasErrors(state: ModelState): boolean {
  return state.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
