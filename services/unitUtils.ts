
const CM_TO_INCH = 0.393701;

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm * CM_TO_INCH;
  const feet = Math.floor(totalInches * (1/12));
  const inches = Math.round((totalInches - feet * 12) * 10) / 10;
  return { feet, inches };
}

export function feetInchesToMeters(feet: number, inches: number): number {
  return (feet * 0.3048) + (inches * 0.0254);
}

export function metersToFeetInches(meters: number): { feet: number; inches: number } {
  return cmToFeetInches(meters * 100);
}

export function formatDimensionUSA(cm: number): string {
  const { feet, inches } = cmToFeetInches(cm);
  if (inches === 0) return `${feet}'`;
  return `${feet}' ${inches}"`;
}

export function formatMetersUSA(meters: number): string {
  const { feet, inches } = metersToFeetInches(meters);
  if (inches === 0) return `${feet}'`;
  return `${feet}' ${inches}"`;
}

export function formatAreaUSA(sqMeters: number): string {
  const sqFt = sqMeters * 10.7639;
  return `${sqFt.toFixed(2)} ft²`;
}
