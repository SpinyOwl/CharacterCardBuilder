import { computed, Injectable, signal } from '@angular/core';
import { createDefaultProject } from '../models/default-project';
import {
  DesignElement,
  DesignElementType,
  GearElement,
  isGearElement,
} from '../models/element.model';
import { Layer } from '../models/layer.model';
import { AppMode, CanvasSettings, PageSetup, Project } from '../models/project.model';
import { normalizeRotation } from '../utils/geometry.utils';

@Injectable({ providedIn: 'root' })
export class ProjectStateService {
  readonly project = signal<Project>(createDefaultProject());
  readonly mode = signal<AppMode>('edit');
  readonly selectedElementId = signal<string | null>(null);
  readonly selectedLayerId = signal<string | null>('layer-top-card');

  readonly visibleLayers = computed(() => this.project().layers.filter((layer) => layer.visible));
  readonly selectedLayer = computed(() => {
    const selectedLayerId = this.selectedLayerId();
    return this.project().layers.find((layer) => layer.id === selectedLayerId) ?? null;
  });
  readonly selectedElement = computed(() => {
    const selectedElementId = this.selectedElementId();
    return selectedElementId ? (this.findElement(selectedElementId)?.element ?? null) : null;
  });
  readonly selectableElements = computed(() => getSelectableElements(this.project()));

  setProject(project: Project): void {
    this.project.set(project);
    this.selectedLayerId.set(project.layers[0]?.id ?? null);
    this.selectedElementId.set(null);
  }

  setMode(mode: AppMode): void {
    this.mode.set(mode);
    if (mode === 'view') {
      this.selectedElementId.set(null);
    }
  }

  selectLayer(layerId: string | null): void {
    this.selectedLayerId.set(layerId);
  }

  selectElement(elementId: string | null): void {
    if (elementId === null) {
      this.selectedElementId.set(null);
      return;
    }

    const found = this.findElement(elementId);
    if (!found || !canEditElement(found.layer, found.element) || this.mode() !== 'edit') {
      return;
    }

    this.selectedLayerId.set(found.layer.id);
    this.selectedElementId.set(elementId);
  }

  updateLayer(layerId: string, patch: Partial<Omit<Layer, 'id' | 'elements'>>): void {
    this.project.update((project) => ({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer,
      ),
    }));
  }

  addLayer(): Layer {
    const layerIndex = this.project().layers.length + 1;
    const layer: Layer = {
      id: this.createId('layer'),
      name: `Layer ${layerIndex}`,
      visible: true,
      locked: false,
      opacity: 1,
      elements: [],
    };

    this.project.update((project) => ({
      ...project,
      layers: [...project.layers, layer],
    }));
    this.selectedLayerId.set(layer.id);
    this.selectedElementId.set(null);
    return layer;
  }

  addElementToSelectedLayer(
    type: Exclude<DesignElementType, 'text' | 'polygon'>,
  ): DesignElement | null {
    const selectedLayerId = this.selectedLayerId() ?? this.project().layers[0]?.id;
    if (!selectedLayerId) {
      return null;
    }

    const element = this.createElement(type, selectedLayerId);
    this.project.update((project) => ({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === selectedLayerId ? { ...layer, elements: [...layer.elements, element] } : layer,
      ),
    }));
    this.selectedLayerId.set(selectedLayerId);
    this.selectedElementId.set(element.id);
    return element;
  }

  updateCanvas(patch: Partial<CanvasSettings>): void {
    this.project.update((project) => ({
      ...project,
      canvas: { ...project.canvas, ...patch },
    }));
  }

  updatePageSetup(pageSetup: PageSetup): void {
    this.project.update((project) => ({
      ...project,
      pageSetup,
    }));
  }

  updateElement(elementId: string, patch: Partial<DesignElement>): void {
    this.project.update((project) => ({
      ...project,
      layers: project.layers.map((layer) => ({
        ...layer,
        elements: layer.elements.map((element) =>
          element.id === elementId ? ({ ...element, ...patch } as DesignElement) : element,
        ),
      })),
    }));
  }

  deleteElement(elementId: string): void {
    this.project.update((project) => ({
      ...project,
      layers: project.layers.map((layer) => ({
        ...layer,
        elements: layer.elements.filter((element) => element.id !== elementId),
      })),
    }));

    if (this.selectedElementId() === elementId) {
      this.selectedElementId.set(null);
    }
  }

  moveElementInEditMode(elementId: string, dx: number, dy: number): void {
    if (this.mode() !== 'edit') {
      return;
    }

    const found = this.findElement(elementId);
    if (!found || !canEditElement(found.layer, found.element)) {
      return;
    }

    this.updateElement(elementId, {
      x: found.element.x + dx,
      y: found.element.y + dy,
    } as Partial<DesignElement>);
  }

  rotateGearInViewMode(elementId: string, deltaDegrees: number): void {
    if (this.mode() !== 'view') {
      return;
    }

    const found = this.findElement(elementId);
    if (!found || !found.layer.visible || !found.element.visible || !isGearElement(found.element)) {
      return;
    }

    this.updateElement(elementId, {
      currentRotation: normalizeRotation(found.element.currentRotation + deltaDegrees),
    } as Partial<GearElement>);
  }

  findElement(elementId: string): { layer: Layer; element: DesignElement } | null {
    for (const layer of this.project().layers) {
      const element = layer.elements.find((candidate) => candidate.id === elementId);
      if (element) {
        return { layer, element };
      }
    }
    return null;
  }

  private createElement(
    type: Exclude<DesignElementType, 'text' | 'polygon'>,
    layerId: string,
  ): DesignElement {
    const canvas = this.project().canvas;
    const base = {
      id: this.createId(type),
      layerId,
      name: this.createElementName(type),
      mode: 'additive' as const,
      x: Math.round(canvas.width / 2 - 15),
      y: Math.round(canvas.height / 2 - 12),
      rotation: 0,
      visible: true,
      locked: false,
    };

    switch (type) {
      case 'rectangle':
        return {
          ...base,
          type: 'rectangle',
          width: 30,
          height: 24,
          radius: 2,
          fill: '#faf7ef',
          stroke: '#5e4b2f',
          strokeWidth: 1,
        };
      case 'circle':
        return {
          ...base,
          type: 'circle',
          x: Math.round(canvas.width / 2),
          y: Math.round(canvas.height / 2),
          radius: 14,
          fill: '#dfe9dc',
          stroke: '#4f6b48',
          strokeWidth: 1,
        };
      case 'triangle':
        return {
          ...base,
          type: 'triangle',
          width: 30,
          height: 26,
          fill: '#e9dfc8',
          stroke: '#6e5a35',
          strokeWidth: 1,
        };
      case 'gear':
        return {
          ...base,
          type: 'gear',
          x: Math.round(canvas.width / 2),
          y: Math.round(canvas.height / 2),
          discRadius: 16,
          toothHeight: 5,
          teeth: 12,
          toothWidth: 55,
          toothShape: 60,
          fill: '#f2c469',
          stroke: '#6e4d19',
          strokeWidth: 1,
          interactive: true,
          currentRotation: 0,
        };
    }
  }

  private createElementName(type: DesignElementType): string {
    const label = type[0].toUpperCase() + type.slice(1);
    const count =
      this.project()
        .layers.flatMap((layer) => layer.elements)
        .filter((element) => element.type === type).length + 1;
    return `${label} ${count}`;
  }

  private createId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
}

export function getSelectableElements(project: Project): DesignElement[] {
  return project.layers
    .filter((layer) => layer.visible && !layer.locked)
    .flatMap((layer) => layer.elements.filter((element) => element.visible && !element.locked));
}

export function canEditElement(layer: Layer, element: DesignElement): boolean {
  return layer.visible && !layer.locked && element.visible && !element.locked;
}
