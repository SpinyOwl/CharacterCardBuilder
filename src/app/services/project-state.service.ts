import { computed, Injectable, signal } from '@angular/core';
import { createDefaultProject } from '../models/default-project';
import { DesignElement, GearElement, isGearElement } from '../models/element.model';
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
}

export function getSelectableElements(project: Project): DesignElement[] {
  return project.layers
    .filter((layer) => layer.visible && !layer.locked)
    .flatMap((layer) => layer.elements.filter((element) => element.visible && !element.locked));
}

export function canEditElement(layer: Layer, element: DesignElement): boolean {
  return layer.visible && !layer.locked && element.visible && !element.locked;
}
