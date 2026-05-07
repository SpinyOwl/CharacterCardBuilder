import { Point } from '../models/element.model';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function polarPoint(radius: number, angle: number): Point {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function roundedRectPath(
  width: number,
  height: number,
  radius = 0,
): string {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const safeRadius = clamp(radius, 0, Math.min(safeWidth, safeHeight) / 2);
  const w = formatNumber(safeWidth);
  const h = formatNumber(safeHeight);
  const r = formatNumber(safeRadius);

  if (safeRadius === 0) {
    return `M 0 0 H ${w} V ${h} H 0 Z`;
  }

  return [
    `M ${r} 0`,
    `H ${formatNumber(safeWidth - safeRadius)}`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `V ${formatNumber(safeHeight - safeRadius)}`,
    `A ${r} ${r} 0 0 1 ${formatNumber(safeWidth - safeRadius)} ${h}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${formatNumber(safeHeight - safeRadius)}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

export function createTrianglePath(width: number, height: number): string {
  return [
    `M ${formatNumber(width / 2)} 0`,
    `L ${formatNumber(width)} ${formatNumber(height)}`,
    `L 0 ${formatNumber(height)}`,
    'Z',
  ].join(' ');
}

export function createPolygonPath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }

  const [first, ...rest] = points;
  return [
    `M ${formatNumber(first.x)} ${formatNumber(first.y)}`,
    ...rest.map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`),
    'Z',
  ].join(' ');
}

export function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

export function formatNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}
