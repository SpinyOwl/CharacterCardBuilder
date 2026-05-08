import { Injectable } from '@angular/core';
import { parse, stringify } from 'yaml';
import { DesignElement, GearLabel } from '../models/element.model';
import { Layer } from '../models/layer.model';
import { PageOrientation, PageSetup, PaperSize, Project } from '../models/project.model';

@Injectable({ providedIn: 'root' })
export class ImportExportService {
  exportYaml(project: Project): string {
    return stringify(project);
  }

  importYaml(source: string): Project {
    const parsed = parse(source) as unknown;
    return assertProject(parsed);
  }
}

export function assertProject(value: unknown): Project {
  if (!isRecord(value)) {
    throw new Error('Project YAML must contain an object.');
  }

  if (value['version'] !== 1) {
    throw new Error('Only project version 1 is supported.');
  }

  const canvas = value['canvas'];
  const layers = value['layers'];
  if (!isRecord(canvas) || canvas['unit'] !== 'mm') {
    throw new Error('Project canvas must use millimeters.');
  }

  if (typeof canvas['width'] !== 'number' || typeof canvas['height'] !== 'number') {
    throw new Error('Project canvas width and height are required.');
  }

  if (!Array.isArray(layers)) {
    throw new Error('Project layers must be an array.');
  }

  return {
    version: 1,
    canvas: {
      width: canvas['width'],
      height: canvas['height'],
      unit: 'mm',
      backgroundColor:
        typeof canvas['backgroundColor'] === 'string' ? canvas['backgroundColor'] : undefined,
    },
    pageSetup: assertPageSetup(value['pageSetup']),
    layers: layers.map(assertLayer),
    editor: isRecord(value['editor'])
      ? {
          selectedLayerId: stringOrNull(value['editor']['selectedLayerId']),
          selectedElementId: stringOrNull(value['editor']['selectedElementId']),
        }
      : undefined,
  };
}

function assertPageSetup(value: unknown): PageSetup | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    paperSize: assertPaperSize(value['paperSize']),
    orientation: assertPageOrientation(value['orientation']),
    marginTop: optionalNumber(value['marginTop'], 0),
    marginBottom: optionalNumber(value['marginBottom'], 0),
    marginLeft: optionalNumber(value['marginLeft'], 0),
    marginRight: optionalNumber(value['marginRight'], 0),
    showPageBorder: value['showPageBorder'] !== false,
  };
}

function assertLayer(value: unknown): Layer {
  if (!isRecord(value) || !Array.isArray(value['elements'])) {
    throw new Error('Each layer must be an object with elements.');
  }

  return {
    id: requiredString(value['id'], 'Layer id'),
    name: requiredString(value['name'], 'Layer name'),
    visible: value['visible'] !== false,
    locked: value['locked'] === true,
    opacity: typeof value['opacity'] === 'number' ? value['opacity'] : 1,
    elements: value['elements'].map(assertElement),
  };
}

function assertElement(value: unknown): DesignElement {
  if (!isRecord(value)) {
    throw new Error('Each element must be an object.');
  }

  const base = {
    id: requiredString(value['id'], 'Element id'),
    layerId: requiredString(value['layerId'], 'Element layerId'),
    name: requiredString(value['name'], 'Element name'),
    x: requiredNumber(value['x'], 'Element x'),
    y: requiredNumber(value['y'], 'Element y'),
    rotation: typeof value['rotation'] === 'number' ? value['rotation'] : 0,
    visible: value['visible'] !== false,
    locked: value['locked'] === true,
    mode: value['mode'] === 'subtractive' ? 'subtractive' : 'additive',
  } as const;
  switch (value['type']) {
    case 'rectangle':
      return {
        ...base,
        ...assertShapeStyle(value),
        type: 'rectangle',
        width: requiredNumber(value['width'], 'Rectangle width'),
        height: requiredNumber(value['height'], 'Rectangle height'),
        radius: typeof value['radius'] === 'number' ? value['radius'] : undefined,
        interaction: assertInteraction(value['interaction']),
      };
    case 'circle':
      return {
        ...base,
        ...assertShapeStyle(value),
        type: 'circle',
        radius: requiredNumber(value['radius'], 'Circle radius'),
        interaction: assertInteraction(value['interaction']),
      };
    case 'triangle':
      return {
        ...base,
        ...assertShapeStyle(value),
        type: 'triangle',
        width: requiredNumber(value['width'], 'Triangle width'),
        height: requiredNumber(value['height'], 'Triangle height'),
        interaction: assertInteraction(value['interaction']),
      };
    case 'polygon':
      return {
        ...base,
        ...assertShapeStyle(value),
        type: 'polygon',
        points: Array.isArray(value['points']) ? value['points'].map(assertPoint) : [],
        interaction: assertInteraction(value['interaction']),
      };
    case 'text':
      return {
        ...base,
        type: 'text',
        text: requiredString(value['text'], 'Text value'),
        fontSize: requiredNumber(value['fontSize'], 'Text fontSize'),
        fontFamily: requiredString(value['fontFamily'], 'Text fontFamily'),
        fontWeight:
          typeof value['fontWeight'] === 'number' || typeof value['fontWeight'] === 'string'
            ? value['fontWeight']
            : '400',
        fill: requiredString(value['fill'], 'Text fill'),
        align: value['align'] === 'middle' || value['align'] === 'end' ? value['align'] : 'start',
      };
    case 'gear':
      return {
        ...base,
        ...assertShapeStyle(value),
        type: 'gear',
        discRadius: requiredNumber(value['discRadius'], 'Gear discRadius'),
        toothHeight: requiredNumber(value['toothHeight'], 'Gear toothHeight'),
        teeth: requiredNumber(value['teeth'], 'Gear teeth'),
        toothWidth: requiredNumber(value['toothWidth'], 'Gear toothWidth'),
        toothShape: requiredNumber(value['toothShape'], 'Gear toothShape'),
        centerDotRadius: optionalNumber(value['centerDotRadius'], 1.8),
        centerDotFill:
          typeof value['centerDotFill'] === 'string' ? value['centerDotFill'] : '#392710',
        centerDotStroke:
          typeof value['centerDotStroke'] === 'string' ? value['centerDotStroke'] : '#f6d48b',
        centerDotStrokeWidth: optionalNumber(value['centerDotStrokeWidth'], 0.4),
        interactive: true,
        currentRotation:
          typeof value['currentRotation'] === 'number' ? value['currentRotation'] : 0,
        interaction: assertInteraction(value['interaction']),
        labels: Array.isArray(value['labels']) ? value['labels'].map(assertGearLabel) : [],
      };
    case 'group':
      return {
        ...base,
        type: 'group',
        elements: Array.isArray(value['elements']) ? value['elements'].map(assertElement) : [],
      };
    default:
      throw new Error(`Unsupported element type: ${String(value['type'])}`);
  }
}

function assertGearLabel(value: unknown): GearLabel {
  if (!isRecord(value)) {
    throw new Error('Gear label must be an object.');
  }

  return {
    id: requiredString(value['id'], 'Gear label id'),
    text: requiredString(value['text'], 'Gear label text'),
    angle: requiredNumber(value['angle'], 'Gear label angle'),
    offsetFromEdge: requiredNumber(value['offsetFromEdge'], 'Gear label offsetFromEdge'),
    rotation: typeof value['rotation'] === 'number' ? value['rotation'] : 0,
    fontSize: typeof value['fontSize'] === 'number' ? value['fontSize'] : 4,
    fontFamily:
      typeof value['fontFamily'] === 'string' ? value['fontFamily'] : 'Arial, sans-serif',
    fontWeight:
      typeof value['fontWeight'] === 'number' || typeof value['fontWeight'] === 'string'
        ? value['fontWeight']
        : '400',
    fill: typeof value['fill'] === 'string' ? value['fill'] : '#392710',
    align: value['align'] === 'start' || value['align'] === 'end' ? value['align'] : 'middle',
  };
}

function assertPoint(value: unknown): { x: number; y: number } {
  if (!isRecord(value)) {
    throw new Error('Polygon point must be an object.');
  }
  return {
    x: requiredNumber(value['x'], 'Point x'),
    y: requiredNumber(value['y'], 'Point y'),
  };
}

function assertInteraction(
  value: unknown,
): { rotationPoint?: { x: number; y: number }; slideAxis?: { x: number; y: number } } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    rotationPoint: isRecord(value['rotationPoint']) ? assertPoint(value['rotationPoint']) : undefined,
    slideAxis: isRecord(value['slideAxis']) ? assertPoint(value['slideAxis']) : undefined,
  };
}

function assertShapeStyle(value: Record<string, unknown>): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  backgroundImage?: string;
} {
  return {
    fill: requiredString(value['fill'], 'Shape fill'),
    stroke: requiredString(value['stroke'], 'Shape stroke'),
    strokeWidth: requiredNumber(value['strokeWidth'], 'Shape strokeWidth'),
    backgroundImage:
      typeof value['backgroundImage'] === 'string' && value['backgroundImage'].trim()
        ? value['backgroundImage']
        : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${label} must be a number.`);
  }
  return value;
}

function optionalNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function assertPaperSize(value: unknown): PaperSize {
  return value === 'A6' || value === 'A5' || value === 'A4' || value === 'A3' || value === 'Letter'
    ? value
    : 'A5';
}

function assertPageOrientation(value: unknown): PageOrientation {
  return value === 'portrait' || value === 'landscape' ? value : 'landscape';
}
