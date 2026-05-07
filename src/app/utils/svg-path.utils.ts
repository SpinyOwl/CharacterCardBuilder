import { formatNumber, polarPoint } from './geometry.utils';

export function moveTo(radius: number, angle: number): string {
  const point = polarPoint(radius, angle);
  return `M ${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

export function lineTo(radius: number, angle: number): string {
  const point = polarPoint(radius, angle);
  return `L ${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

export function arcTo(radius: number, startAngle: number, endAngle: number): string {
  const end = polarPoint(radius, endAngle);
  const delta = Math.abs(endAngle - startAngle);
  const largeArc = delta > Math.PI ? 1 : 0;
  const sweep = endAngle > startAngle ? 1 : 0;
  return `A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArc} ${sweep} ${formatNumber(end.x)} ${formatNumber(end.y)}`;
}
