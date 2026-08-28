import type { Vector2 } from '@atlasmechanica/model';
import { add2, magnitude2, scale2, subtract2 } from './planarRigidBody.js';

const GEOMETRY_EPSILON = 1e-12;
const SINGULARITY_EPSILON = 1e-12;

export interface CircleIntersectionResult {
  points: Vector2[];
  tangent: boolean;
}

export interface FourBarRates {
  coupler: number;
  rocker: number;
}

export function circleIntersections(
  centerA: Vector2,
  radiusA: number,
  centerB: Vector2,
  radiusB: number,
): CircleIntersectionResult | undefined {
  const centerDelta = subtract2(centerB, centerA);
  const distance = magnitude2(centerDelta);

  if (radiusA <= 0 || radiusB <= 0 || distance <= GEOMETRY_EPSILON) {
    return undefined;
  }

  if (
    distance > radiusA + radiusB + GEOMETRY_EPSILON ||
    distance < Math.abs(radiusA - radiusB) - GEOMETRY_EPSILON
  ) {
    return undefined;
  }

  const x =
    (radiusA ** 2 - radiusB ** 2 + distance ** 2) / (2 * distance);
  const heightSquared = radiusA ** 2 - x ** 2;
  if (heightSquared < -GEOMETRY_EPSILON) return undefined;

  const direction = scale2(centerDelta, 1 / distance);
  const base = add2(centerA, scale2(direction, x));
  const height = Math.sqrt(Math.max(0, heightSquared));
  if (height <= GEOMETRY_EPSILON) {
    return { points: [base], tangent: true };
  }

  const perpendicular = { x: -direction.y, y: direction.x };
  const offset = scale2(perpendicular, height);
  return {
    points: [add2(base, offset), subtract2(base, offset)],
    tangent: false,
  };
}

function solve2x2(
  a11: number,
  a12: number,
  a21: number,
  a22: number,
  b1: number,
  b2: number,
): readonly [number, number] | undefined {
  const determinant = a11 * a22 - a12 * a21;
  if (Math.abs(determinant) <= SINGULARITY_EPSILON) return undefined;

  return [
    (b1 * a22 - a12 * b2) / determinant,
    (a11 * b2 - b1 * a21) / determinant,
  ];
}

export function solveFourBarVelocity(
  crankLength: number,
  couplerLength: number,
  rockerLength: number,
  theta2: number,
  theta3: number,
  theta4: number,
  omega2: number,
): FourBarRates | undefined {
  const solution = solve2x2(
    -couplerLength * Math.sin(theta3),
    rockerLength * Math.sin(theta4),
    couplerLength * Math.cos(theta3),
    -rockerLength * Math.cos(theta4),
    crankLength * Math.sin(theta2) * omega2,
    -crankLength * Math.cos(theta2) * omega2,
  );

  return solution === undefined
    ? undefined
    : { coupler: solution[0], rocker: solution[1] };
}

export function solveFourBarAcceleration(
  crankLength: number,
  couplerLength: number,
  rockerLength: number,
  theta2: number,
  theta3: number,
  theta4: number,
  omega2: number,
  omega3: number,
  omega4: number,
  alpha2: number,
): FourBarRates | undefined {
  const solution = solve2x2(
    -couplerLength * Math.sin(theta3),
    rockerLength * Math.sin(theta4),
    couplerLength * Math.cos(theta3),
    -rockerLength * Math.cos(theta4),
    crankLength * Math.cos(theta2) * omega2 ** 2 +
      crankLength * Math.sin(theta2) * alpha2 +
      couplerLength * Math.cos(theta3) * omega3 ** 2 -
      rockerLength * Math.cos(theta4) * omega4 ** 2,
    crankLength * Math.sin(theta2) * omega2 ** 2 -
      crankLength * Math.cos(theta2) * alpha2 +
      couplerLength * Math.sin(theta3) * omega3 ** 2 -
      rockerLength * Math.sin(theta4) * omega4 ** 2,
  );

  return solution === undefined
    ? undefined
    : { coupler: solution[0], rocker: solution[1] };
}
