import type {
  ConfigurationId,
  CoordinateId,
  ModelId,
  ParameterId,
  QuantityValue,
  SignalId,
  UnitCode,
} from '@atlasmechanica/model';

export const MECHANISM_LAB_SCHEMA_VERSION = '0.1' as const;

export type LabView = '2d' | '3d';
export type LabDisplayUnit = UnitCode | 'rpm';

export type LabInteractionDefinition =
  | {
      readonly handle: 'input';
      readonly mapping: {
        readonly type: 'polar-angle';
        readonly origin: readonly [number, number];
      };
    }
  | {
      readonly handle: 'parameter';
      readonly mapping: {
        readonly type: 'axis-value';
        readonly axis: 'x' | 'y';
        readonly scale: number;
      };
    };

interface LabControlBase {
  readonly id: string;
  readonly label?: string;
  readonly unit: LabDisplayUnit;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly initial: number;
  readonly queryKey?: string;
  readonly interaction?: LabInteractionDefinition;
}

export type LabControlDefinition =
  | (LabControlBase & {
      readonly kind: 'parameter';
      readonly parameter: ParameterId;
    })
  | (LabControlBase & {
      readonly kind: 'coordinate';
      readonly coordinate: CoordinateId;
    })
  | (LabControlBase & {
      readonly kind: 'rate';
      readonly coordinate: CoordinateId;
    });

export type LabReadoutSource =
  | {
      readonly kind: 'signal';
      readonly signal: SignalId;
    }
  | {
      readonly kind: 'coordinate-position';
      readonly coordinate: CoordinateId;
    }
  | {
      readonly kind: 'coordinate-rate';
      readonly coordinate: CoordinateId;
    };

export interface LabReadoutDefinition {
  readonly id: string;
  readonly label?: string;
  readonly source: LabReadoutSource;
  readonly absolute?: boolean;
  readonly scale?: number;
  readonly digits?: number;
  readonly suffix?: string;
  readonly textMap?: Readonly<Record<string, string>>;
}

export interface MechanismLabDefinition {
  readonly schemaVersion: typeof MECHANISM_LAB_SCHEMA_VERSION;
  readonly id: string;
  readonly modelId: ModelId;
  readonly subtitle?: string;
  readonly sceneCompilerId: string;
  readonly modelTransformId?: string;
  readonly threeRendererId?: string;
  readonly sessionConfiguration?: ConfigurationId;
  readonly views: readonly LabView[];
  readonly parameterOverrides?: Readonly<Record<ParameterId, QuantityValue>>;
  readonly controls: readonly LabControlDefinition[];
  readonly readouts: readonly LabReadoutDefinition[];
  readonly animation?: {
    readonly coordinateControlId: string;
    readonly rateControlId: string;
  };
  readonly renderer2d?: {
    readonly keyboardParameterAxis?: 'x' | 'y';
    readonly responsiveStrokeReferenceWidth?: number;
  };
}

export function defineMechanismLab<const T extends MechanismLabDefinition>(definition: T): T {
  return definition;
}
