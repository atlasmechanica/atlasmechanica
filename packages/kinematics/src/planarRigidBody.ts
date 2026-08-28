import type { BodyState, Pose2D, Vector2 } from '@atlasmechanica/model';

export function add2(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract2(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale2(vector: Vector2, factor: number): Vector2 {
  return { x: vector.x * factor, y: vector.y * factor };
}

export function magnitude2(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

export function cross2(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}

export function rotate2(vector: Vector2, angle: number): Vector2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * vector.x - sine * vector.y,
    y: sine * vector.x + cosine * vector.y,
  };
}

/** Return k × r for a planar vector r and scalar angular rate k. */
export function angularCross(angular: number, radius: Vector2): Vector2 {
  return { x: -angular * radius.y, y: angular * radius.x };
}

export function worldPoint2(pose: Pose2D, localPoint: Vector2): Vector2 {
  return add2({ x: pose.x, y: pose.y }, rotate2(localPoint, pose.angle));
}

/**
 * Compute a body pose that maps two body-local points onto two world points.
 * Returns undefined for degenerate point pairs.
 */
export function alignTwoPoints2(
  localA: Vector2,
  localB: Vector2,
  worldA: Vector2,
  worldB: Vector2,
): Pose2D | undefined {
  const localDelta = subtract2(localB, localA);
  const worldDelta = subtract2(worldB, worldA);
  if (magnitude2(localDelta) === 0 || magnitude2(worldDelta) === 0) {
    return undefined;
  }

  const angle =
    Math.atan2(worldDelta.y, worldDelta.x) -
    Math.atan2(localDelta.y, localDelta.x);
  const rotatedLocalA = rotate2(localA, angle);

  return {
    x: worldA.x - rotatedLocalA.x,
    y: worldA.y - rotatedLocalA.y,
    angle,
  };
}

/**
 * Derive a body-origin velocity from the known velocity of one body-fixed point.
 */
export function bodyOriginVelocityFromPoint(
  pose: Pose2D,
  localPoint: Vector2,
  pointVelocity: Vector2,
  angularVelocity: number,
): Vector2 {
  const radiusFromOrigin = rotate2(localPoint, pose.angle);
  return subtract2(pointVelocity, angularCross(angularVelocity, radiusFromOrigin));
}

/**
 * Derive a body-origin acceleration from one body-fixed point with known
 * acceleration plus the body's angular velocity/acceleration.
 */
export function bodyOriginAccelerationFromPoint(
  pose: Pose2D,
  localPoint: Vector2,
  pointAcceleration: Vector2,
  angularVelocity: number,
  angularAcceleration: number,
): Vector2 {
  const radiusFromOrigin = rotate2(localPoint, pose.angle);
  const tangential = angularCross(angularAcceleration, radiusFromOrigin);
  const centripetal = scale2(radiusFromOrigin, -(angularVelocity ** 2));
  return subtract2(pointAcceleration, add2(tangential, centripetal));
}

export function bodyPointVelocity(
  state: BodyState,
  localPoint: Vector2,
): Vector2 | undefined {
  if (state.linearVelocity === undefined || state.angularVelocity === undefined) {
    return undefined;
  }

  const radius = rotate2(localPoint, state.pose.angle);
  return add2(state.linearVelocity, angularCross(state.angularVelocity, radius));
}

export function bodyPointAcceleration(
  state: BodyState,
  localPoint: Vector2,
): Vector2 | undefined {
  if (
    state.linearAcceleration === undefined ||
    state.angularVelocity === undefined ||
    state.angularAcceleration === undefined
  ) {
    return undefined;
  }

  const radius = rotate2(localPoint, state.pose.angle);
  return add2(
    state.linearAcceleration,
    add2(
      angularCross(state.angularAcceleration, radius),
      scale2(radius, -(state.angularVelocity ** 2)),
    ),
  );
}
