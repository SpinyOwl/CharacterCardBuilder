import { computed, Injectable, signal } from '@angular/core';
import { createDefaultProject } from '../models/default-project';
import {
  DesignElement,
  DesignElementType,
  GearElement,
  RotationInteraction,
  ShapeInteraction,
  SlideInteraction,
  isGearElement,
  isGroupElement,
  isShapeElement,
} from '../models/element.model';
import { Layer } from '../models/layer.model';
import { AppMode, CanvasSettings, PageSetup, Project } from '../models/project.model';
import { normalizeRotation } from '../utils/geometry.utils';
import { assertProject } from './import-export.service';

export type ElementContainer =
  | { kind: 'layer'; layerId: string }
  | { kind: 'group'; groupId: string };

export interface ElementViewTransform {
  x: number;
  y: number;
  rotation: number;
}

const PROJECT_STORAGE_KEY = 'character-card-builder:current-project';

@Injectable({ providedIn: 'root' })
export class ProjectStateService {
  readonly project = signal<Project>(loadStoredProject());
  readonly mode = signal<AppMode>('edit');
  readonly selectedElementId = signal<string | null>(null);
  readonly selectedLayerId = signal<string | null>('layer-top-card');
  readonly viewTransforms = signal<Record<string, ElementViewTransform>>({});

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
    this.persistProject();
    this.selectedLayerId.set(project.layers[0]?.id ?? null);
    this.selectedElementId.set(null);
    this.viewTransforms.set({});
  }

  setMode(mode: AppMode): void {
    this.mode.set(mode);
    if (mode === 'view') {
      this.selectedElementId.set(null);
      this.viewTransforms.set({});
    }

    if (mode === 'edit') {
      this.viewTransforms.set({});
    }
  }

  elementViewTransform(element: DesignElement): ElementViewTransform {
    return (
      this.viewTransforms()[element.id] ?? {
        x: element.x,
        y: element.y,
        rotation: element.rotation,
      }
    );
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
    this.updateProject((project) => ({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer,
      ),
    }));
  }

  reorderLayer(previousIndex: number, currentIndex: number): void {
    this.updateProject((project) => {
      const layers = [...project.layers];
      moveItemInArray(layers, previousIndex, currentIndex);
      return { ...project, layers };
    });
  }

  reorderElements(container: ElementContainer, previousIndex: number, currentIndex: number): void {
    this.updateProject((project) => ({
      ...project,
      layers: project.layers.map((layer) => {
        if (container.kind === 'layer' && layer.id === container.layerId) {
          const elements = [...layer.elements];
          moveItemInArray(elements, previousIndex, currentIndex);
          return { ...layer, elements };
        }

        return {
          ...layer,
          elements:
            container.kind === 'group'
              ? reorderGroupElements(layer.elements, container.groupId, previousIndex, currentIndex)
              : layer.elements,
        };
      }),
    }));
  }

  moveElementToContainer(elementId: string, target: ElementContainer, targetIndex: number): void {
    const found = this.findElement(elementId);
    if (
      !found ||
      found.element.locked ||
      (isGroupElement(found.element) && isDescendant(found.element, target))
    ) {
      return;
    }

    this.updateProject((project) => {
      const removal = removeElementFromLayers(project.layers, elementId);
      if (!removal.element) {
        return project;
      }

      return {
        ...project,
        layers: insertElementIntoLayers(removal.layers, target, removal.element, targetIndex),
      };
    });
  }

  elementContainer(elementId: string): ElementContainer | null {
    for (const layer of this.project().layers) {
      const container = findElementContainer(layer.elements, elementId, {
        kind: 'layer',
        layerId: layer.id,
      });
      if (container) {
        return container;
      }
    }
    return null;
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

    this.updateProject((project) => ({
      ...project,
      layers: [...project.layers, layer],
    }));
    this.selectedLayerId.set(layer.id);
    this.selectedElementId.set(null);
    return layer;
  }

  addElementToSelectedLayer(type: Exclude<DesignElementType, 'polygon'>): DesignElement | null {
    const selectedLayerId = this.selectedLayerId() ?? this.project().layers[0]?.id;
    if (!selectedLayerId) {
      return null;
    }

    const element = this.createElement(type, selectedLayerId);
    const selectedElementId = this.selectedElementId();
    const selectedGroup = selectedElementId ? this.findElement(selectedElementId) : null;
    const targetGroupId =
      selectedGroup && isGroupElement(selectedGroup.element) ? selectedGroup.element.id : null;

    this.updateProject((project) => ({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === selectedLayerId
          ? {
              ...layer,
              elements: targetGroupId
                ? addElementToGroup(layer.elements, targetGroupId, element)
                : [...layer.elements, element],
            }
          : layer,
      ),
    }));
    this.selectedLayerId.set(selectedLayerId);
    this.selectedElementId.set(element.id);
    return element;
  }

  updateCanvas(patch: Partial<CanvasSettings>): void {
    this.updateProject((project) => ({
      ...project,
      canvas: { ...project.canvas, ...patch },
    }));
  }

  updatePageSetup(pageSetup: PageSetup): void {
    this.updateProject((project) => ({
      ...project,
      pageSetup,
    }));
  }

  updateElement(elementId: string, patch: Partial<DesignElement>): void {
    const found = this.findElement(elementId);
    if (found?.element.locked && !isLockControlPatch(patch)) {
      return;
    }

    this.updateProject((project) => ({
      ...project,
      layers: project.layers.map((layer) => ({
        ...layer,
        elements: updateElementInList(layer.elements, elementId, patch),
      })),
    }));
  }

  updateElementInteraction(
    elementId: string,
    interactionId: string,
    patch: Partial<ShapeInteraction>,
  ): void {
    const found = this.findElement(elementId);
    if (!found || !isShapeElement(found.element) || found.element.locked) {
      return;
    }

    const interactions = (found.element.interactions ?? []).map((interaction) =>
      interaction.id === interactionId
        ? ({ ...interaction, ...patch } as ShapeInteraction)
        : interaction,
    );
    this.updateElement(elementId, { interactions } as Partial<DesignElement>);
  }

  deleteElement(elementId: string): void {
    const found = this.findElement(elementId);
    if (found?.element.locked) {
      return;
    }

    this.updateProject((project) => ({
      ...project,
      layers: project.layers.map((layer) => ({
        ...layer,
        elements: deleteElementFromList(layer.elements, elementId),
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

  rotateElementAroundPivotInViewMode(
    elementId: string,
    interactionId: string,
    deltaDegrees: number,
  ): void {
    if (this.mode() !== 'view') {
      return;
    }

    const found = this.findElement(elementId);
    if (!found || !canEditElement(found.layer, found.element) || !isShapeElement(found.element)) {
      return;
    }

    const interaction = (found.element.interactions ?? []).find(
      (candidate): candidate is RotationInteraction =>
        candidate.id === interactionId && candidate.type === 'rotation',
    );
    if (!interaction) {
      return;
    }

    const current = this.elementViewTransform(found.element);
    const pivot = elementLocalPointToWorld(current, {
      x: interaction.pivotX,
      y: interaction.pivotY,
    });
    const radians = (deltaDegrees * Math.PI) / 180;
    const dx = current.x - pivot.x;
    const dy = current.y - pivot.y;
    this.updateViewTransform(elementId, {
      x: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians),
      rotation: normalizeRotation(current.rotation + deltaDegrees),
    });
  }

  slideElementAlongAxisInViewMode(
    elementId: string,
    interactionId: string,
    dx: number,
    dy: number,
  ): void {
    if (this.mode() !== 'view') {
      return;
    }

    const found = this.findElement(elementId);
    if (!found || !canEditElement(found.layer, found.element) || !isShapeElement(found.element)) {
      return;
    }

    const interaction = (found.element.interactions ?? []).find(
      (candidate): candidate is SlideInteraction =>
        candidate.id === interactionId && candidate.type === 'slide',
    );
    if (!interaction) {
      return;
    }

    const current = this.elementViewTransform(found.element);
    const start = elementLocalPointToWorld(current, {
      x: interaction.startX,
      y: interaction.startY,
    });
    const end = elementLocalPointToWorld(current, {
      x: interaction.endX,
      y: interaction.endY,
    });
    const axisX = end.x - start.x;
    const axisY = end.y - start.y;
    const axisLength = Math.hypot(axisX, axisY);
    if (axisLength === 0) {
      return;
    }

    const projectedDistance = (dx * axisX + dy * axisY) / axisLength;
    this.updateViewTransform(elementId, {
      ...current,
      x: current.x + (axisX / axisLength) * projectedDistance,
      y: current.y + (axisY / axisLength) * projectedDistance,
    });
  }

  rotateGearInViewMode(elementId: string, deltaDegrees: number): void {
    if (this.mode() !== 'view') {
      return;
    }

    const found = this.findElement(elementId);
    if (!found || !canEditElement(found.layer, found.element) || !isGearElement(found.element)) {
      return;
    }

    this.updateElement(elementId, {
      currentRotation: normalizeRotation(found.element.currentRotation + deltaDegrees),
    } as Partial<GearElement>);
  }

  findElement(elementId: string): { layer: Layer; element: DesignElement } | null {
    for (const layer of this.project().layers) {
      const element = findElementInList(layer.elements, elementId);
      if (element) {
        return { layer, element };
      }
    }
    return null;
  }

  private createElement(type: Exclude<DesignElementType, 'polygon'>, layerId: string): DesignElement {
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
          interactions: [],
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
          interactions: [],
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
          interactions: [],
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
          centerDotRadius: 1.8,
          centerDotFill: '#392710',
          centerDotStroke: '#f6d48b',
          centerDotStrokeWidth: 0.4,
          fill: '#f2c469',
          stroke: '#6e4d19',
          strokeWidth: 1,
          interactive: true,
          currentRotation: 0,
          labels: [],
          interactions: [],
        };
      case 'text':
        return {
          ...base,
          type: 'text',
          x: Math.round(canvas.width / 2),
          y: Math.round(canvas.height / 2),
          text: 'Text',
          fontSize: 8,
          fontFamily: 'Arial, sans-serif',
          fontWeight: '400',
          fill: '#2f332f',
          align: 'middle',
        };
      case 'group':
        return {
          ...base,
          type: 'group',
          name: this.createElementName('group'),
          x: 0,
          y: 0,
          elements: [],
        };
    }
  }

  private createElementName(type: DesignElementType): string {
    const label = type[0].toUpperCase() + type.slice(1);
    const count =
      this.project()
        .layers.flatMap((layer) => flattenElements(layer.elements))
        .filter((element) => element.type === type).length + 1;
    return `${label} ${count}`;
  }

  private createId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }

  private updateProject(updater: (project: Project) => Project): void {
    this.project.update(updater);
    this.persistProject();
  }

  private persistProject(): void {
    try {
      globalThis.localStorage?.setItem(PROJECT_STORAGE_KEY, JSON.stringify(this.project()));
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }

  private updateViewTransform(elementId: string, transform: ElementViewTransform): void {
    this.viewTransforms.update((transforms) => ({
      ...transforms,
      [elementId]: transform,
    }));
  }
}

function loadStoredProject(): Project {
  try {
    const storedProject = globalThis.localStorage?.getItem(PROJECT_STORAGE_KEY);
    return storedProject ? assertProject(JSON.parse(storedProject)) : createDefaultProject();
  } catch {
    return createDefaultProject();
  }
}

export function getSelectableElements(project: Project): DesignElement[] {
  return project.layers
    .filter((layer) => layer.visible && !layer.locked)
    .flatMap((layer) =>
      flattenElements(layer.elements).filter((element) => element.visible && !element.locked),
    );
}

export function canEditElement(layer: Layer, element: DesignElement): boolean {
  return layer.visible && !layer.locked && element.visible && !element.locked;
}

function isLockControlPatch(patch: Partial<DesignElement>): boolean {
  const editableWhileLocked = new Set<keyof DesignElement>(['locked', 'visible']);
  return Object.keys(patch).every((key) => editableWhileLocked.has(key as keyof DesignElement));
}

function elementLocalPointToWorld(
  transform: ElementViewTransform,
  point: { x: number; y: number },
): {
  x: number;
  y: number;
} {
  const radians = (transform.rotation * Math.PI) / 180;
  return {
    x: transform.x + point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: transform.y + point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function updateElementInList(
  elements: DesignElement[],
  elementId: string,
  patch: Partial<DesignElement>,
): DesignElement[] {
  return elements.map((element) => {
    if (element.id === elementId) {
      return { ...element, ...patch } as DesignElement;
    }
    return isGroupElement(element)
      ? { ...element, elements: updateElementInList(element.elements, elementId, patch) }
      : element;
  });
}

function addElementToGroup(
  elements: DesignElement[],
  groupId: string,
  child: DesignElement,
): DesignElement[] {
  return elements.map((element) => {
    if (!isGroupElement(element)) {
      return element;
    }
    if (element.id === groupId) {
      return { ...element, elements: [...element.elements, child] };
    }
    return { ...element, elements: addElementToGroup(element.elements, groupId, child) };
  });
}

function deleteElementFromList(elements: DesignElement[], elementId: string): DesignElement[] {
  return elements
    .filter((element) => element.id !== elementId)
    .map((element) =>
      isGroupElement(element)
        ? { ...element, elements: deleteElementFromList(element.elements, elementId) }
        : element,
    );
}

function findElementInList(elements: DesignElement[], elementId: string): DesignElement | null {
  for (const element of elements) {
    if (element.id === elementId) {
      return element;
    }
    if (isGroupElement(element)) {
      const found = findElementInList(element.elements, elementId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function flattenElements(elements: DesignElement[]): DesignElement[] {
  return elements.flatMap((element) =>
    isGroupElement(element) ? [element, ...flattenElements(element.elements)] : [element],
  );
}

function moveItemInArray<T>(items: T[], previousIndex: number, currentIndex: number): void {
  const [item] = items.splice(previousIndex, 1);
  items.splice(currentIndex, 0, item);
}

function reorderGroupElements(
  elements: DesignElement[],
  groupId: string,
  previousIndex: number,
  currentIndex: number,
): DesignElement[] {
  return elements.map((element) => {
    if (!isGroupElement(element)) {
      return element;
    }
    if (element.id === groupId) {
      const children = [...element.elements];
      moveItemInArray(children, previousIndex, currentIndex);
      return { ...element, elements: children };
    }
    return {
      ...element,
      elements: reorderGroupElements(element.elements, groupId, previousIndex, currentIndex),
    };
  });
}

function removeElementFromLayers(
  layers: Layer[],
  elementId: string,
): { layers: Layer[]; element: DesignElement | null } {
  let removed: DesignElement | null = null;
  return {
    layers: layers.map((layer) => {
      const result = removeElementFromList(layer.elements, elementId);
      removed ??= result.element;
      return { ...layer, elements: result.elements };
    }),
    element: removed,
  };
}

function removeElementFromList(
  elements: DesignElement[],
  elementId: string,
): { elements: DesignElement[]; element: DesignElement | null } {
  let removed: DesignElement | null = null;
  const next: DesignElement[] = [];

  for (const element of elements) {
    if (element.id === elementId) {
      removed = element;
      continue;
    }

    if (isGroupElement(element)) {
      const result = removeElementFromList(element.elements, elementId);
      removed ??= result.element;
      next.push({ ...element, elements: result.elements });
    } else {
      next.push(element);
    }
  }

  return { elements: next, element: removed };
}

function insertElementIntoLayers(
  layers: Layer[],
  target: ElementContainer,
  element: DesignElement,
  targetIndex: number,
): Layer[] {
  return layers.map((layer) => {
    if (target.kind === 'layer' && layer.id === target.layerId) {
      return { ...layer, elements: insertAt(layer.elements, element, targetIndex) };
    }

    return {
      ...layer,
      elements:
        target.kind === 'group'
          ? insertElementIntoGroup(layer.elements, target.groupId, element, targetIndex)
          : layer.elements,
    };
  });
}

function insertElementIntoGroup(
  elements: DesignElement[],
  groupId: string,
  child: DesignElement,
  targetIndex: number,
): DesignElement[] {
  return elements.map((element) => {
    if (!isGroupElement(element)) {
      return element;
    }
    if (element.id === groupId) {
      return { ...element, elements: insertAt(element.elements, child, targetIndex) };
    }
    return {
      ...element,
      elements: insertElementIntoGroup(element.elements, groupId, child, targetIndex),
    };
  });
}

function insertAt(
  elements: DesignElement[],
  element: DesignElement,
  index: number,
): DesignElement[] {
  const next = [...elements];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, element);
  return next;
}

function isDescendant(group: DesignElement, target: ElementContainer): boolean {
  return (
    target.kind === 'group' &&
    isGroupElement(group) &&
    flattenElements(group.elements).some((child) => child.id === target.groupId)
  );
}

function findElementContainer(
  elements: DesignElement[],
  elementId: string,
  container: ElementContainer,
): ElementContainer | null {
  for (const element of elements) {
    if (element.id === elementId) {
      return container;
    }
    if (isGroupElement(element)) {
      const childContainer = findElementContainer(element.elements, elementId, {
        kind: 'group',
        groupId: element.id,
      });
      if (childContainer) {
        return childContainer;
      }
    }
  }
  return null;
}
