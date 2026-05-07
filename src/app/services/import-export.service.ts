import { Injectable } from '@angular/core';
import { parse, stringify } from 'yaml';
import { DesignElement } from '../models/element.model';
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
        type: 'rectangle',
        width: requiredNumber(value['width'], 'Rectangle width'),
        height: requiredNumber(value['height'], 'Rectangle height'),
        radius: typeof value['radius'] === 'number' ? value['radius'] : undefined,
        fill: requiredString(value['fill'], 'Rectangle fill'),
        stroke: requiredString(value['stroke'], 'Rectangle stroke'),
        strokeWidth: requiredNumber(value['strokeWidth'], 'Rectangle strokeWidth'),
      };
    case 'circle':
      return {
        ...base,
        type: 'circle',
        radius: requiredNumber(value['radius'], 'Circle radius'),
        fill: requiredString(value['fill'], 'Circle fill'),
        stroke: requiredString(value['stroke'], 'Circle stroke'),
        strokeWidth: requiredNumber(value['strokeWidth'], 'Circle strokeWidth'),
      };
    case 'triangle':
      return {
        ...base,
        type: 'triangle',
        width: requiredNumber(value['width'], 'Triangle width'),
        height: requiredNumber(value['height'], 'Triangle height'),
        fill: requiredString(value['fill'], 'Triangle fill'),
        stroke: requiredString(value['stroke'], 'Triangle stroke'),
        strokeWidth: requiredNumber(value['strokeWidth'], 'Triangle strokeWidth'),
      };
    case 'polygon':
      return {
        ...base,
        type: 'polygon',
        points: Array.isArray(value['points']) ? value['points'].map(assertPoint) : [],
        fill: requiredString(value['fill'], 'Polygon fill'),
        stroke: requiredString(value['stroke'], 'Polygon stroke'),
        strokeWidth: requiredNumber(value['strokeWidth'], 'Polygon strokeWidth'),
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
        type: 'gear',
        discRadius: requiredNumber(value['discRadius'], 'Gear discRadius'),
        toothHeight: requiredNumber(value['toothHeight'], 'Gear toothHeight'),
        teeth: requiredNumber(value['teeth'], 'Gear teeth'),
        toothWidth: requiredNumber(value['toothWidth'], 'Gear toothWidth'),
        toothShape: requiredNumber(value['toothShape'], 'Gear toothShape'),
        fill: requiredString(value['fill'], 'Gear fill'),
        stroke: requiredString(value['stroke'], 'Gear stroke'),
        strokeWidth: requiredNumber(value['strokeWidth'], 'Gear strokeWidth'),
        interactive: true,
        currentRotation:
          typeof value['currentRotation'] === 'number' ? value['currentRotation'] : 0,
      };
    default:
      throw new Error(`Unsupported element type: ${String(value['type'])}`);
  }
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
