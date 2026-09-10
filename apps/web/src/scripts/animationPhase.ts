export interface PeriodicAnimationStep {
  readonly evaluationValue: number;
  readonly presentationValue: number;
}

export function wrapPeriodicValue(value: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) return value;
  return ((value - min) % span + span) % span + min;
}

/**
 * Advance a periodic coordinate without discarding completed turns.
 *
 * `evaluationValue` is intentionally unwrapped so model-owned travel/phase
 * signals stay continuous. `presentationValue` is the bounded equivalent used
 * by sliders, labels, and URLs.
 */
export function advancePeriodicAnimation(
  currentEvaluationValue: number,
  delta: number,
  min: number,
  max: number,
): PeriodicAnimationStep {
  const evaluationValue = currentEvaluationValue + delta;
  return {
    evaluationValue,
    presentationValue: wrapPeriodicValue(evaluationValue, min, max),
  };
}
