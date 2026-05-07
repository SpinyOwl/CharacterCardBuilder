import { clamp } from './geometry.utils';
import { arcTo, lineTo, moveTo } from './svg-path.utils';

export interface GearPathOptions {
  discRadius: number;
  toothHeight: number;
  teeth: number;
  toothWidth: number;
  toothShape: number;
}

export function createGearPath({
  discRadius,
  toothHeight,
  teeth,
  toothWidth,
  toothShape,
}: GearPathOptions): string {
  const safeDiscRadius = Math.max(0, discRadius);
  const safeTeeth = Math.max(3, Math.round(teeth));
  const outerRadius = Math.max(0, safeDiscRadius + toothHeight);
  const toothAngle = (Math.PI * 2) / safeTeeth;
  const halfSector = toothAngle / 2;
  const tipRatio = clamp(toothWidth, 0, 100) / 100;
  const halfTipAngle = toothAngle * (0.08 + tipRatio * 0.34);
  const shape = clamp(toothShape, 0, 100) / 100;

  let path = '';

  for (let i = 0; i < safeTeeth; i += 1) {
    const center = -Math.PI / 2 + i * toothAngle;
    const rootStart = center - halfSector;
    const rootEnd = center + halfSector;
    const leftTop = center - halfTipAngle;
    const rightTop = center + halfTipAngle;

    const leftRise = clamp(
      rootStart + (leftTop - rootStart) * shape,
      rootStart + 0.0001,
      leftTop - 0.0001,
    );

    const rightFall = clamp(
      rightTop + (rootEnd - rightTop) * (1 - shape),
      rightTop + 0.0001,
      rootEnd - 0.0001,
    );

    if (i === 0) {
      path += moveTo(safeDiscRadius, rootStart);
    }

    path += ` ${arcTo(safeDiscRadius, rootStart, leftRise)}`;
    path += ` ${lineTo(outerRadius, leftTop)}`;
    path += ` ${arcTo(outerRadius, leftTop, rightTop)}`;
    path += ` ${lineTo(safeDiscRadius, rightFall)}`;
    path += ` ${arcTo(safeDiscRadius, rightFall, rootEnd)}`;
  }

  return `${path} Z`;
}
