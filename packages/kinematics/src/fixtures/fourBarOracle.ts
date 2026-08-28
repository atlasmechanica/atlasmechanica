export interface FourBarOracleCheckpoint {
  driverAngleDeg: number;
  pointB: { x: number; y: number };
  couplerAngle: number;
  rockerAngle: number;
  couplerAngularVelocity: number;
  rockerAngularVelocity: number;
  couplerAngularAcceleration: number;
  rockerAngularAcceleration: number;
}

/**
 * Independent acceptance values for the canonical open four-bar branch.
 * Length values are meters, angles radians, rates rad/s, accelerations rad/s².
 *
 * These values are fixture/oracle data only. The analytic adapter does not
 * import this module.
 */
export const canonicalFourBarOpenOracle: readonly FourBarOracleCheckpoint[] = [
  {
    driverAngleDeg: 0,
    pointB: { x: 0.075714285714286, y: 0.065652144531863 },
    couplerAngle: 0.962550747884687,
    rockerAngle: 1.925101495769374,
    couplerAngularVelocity: -0.428571428571428,
    rockerAngularVelocity: -0.428571428571428,
    couplerAngularAcceleration: -0.226478583003587,
    rockerAngularAcceleration: 0.42631262683028,
  },
  {
    driverAngleDeg: 90,
    pointB: { x: 0.072283745225284, y: 0.064279150750948 },
    couplerAngle: 0.442820239756869,
    rockerAngle: 1.977894684153687,
    couplerAngularVelocity: -0.148574720813653,
    rockerAngularVelocity: 0.387481546605244,
    couplerAngularAcceleration: 0.213903222499746,
    rockerAngularAcceleration: 0.203633945346128,
  },
  {
    driverAngleDeg: 180,
    pointB: { x: 0.040769230769231, y: 0.037305709701484 },
    couplerAngle: 0.485127748190971,
    rockerAngle: 2.579522850584166,
    couplerAngularVelocity: 0.230769230769231,
    rockerAngularVelocity: 0.230769230769231,
    couplerAngularAcceleration: 0.281842587030439,
    rockerAngularAcceleration: -0.336746987101303,
  },
  {
    driverAngleDeg: 270,
    pointB: { x: 0.041477722664624, y: 0.03840759111792 },
    couplerAngle: 1.025733828712603,
    rockerAngle: 2.560808273109421,
    couplerAngularVelocity: 0.313712335492552,
    rockerAngularVelocity: -0.222343931926345,
    couplerAngularAcceleration: -0.245654053823796,
    rockerAngularAcceleration: -0.255923330977414,
  },
] as const;
