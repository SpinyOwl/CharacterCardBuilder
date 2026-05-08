import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, output } from '@angular/core';
import {
  DesignElement,
  GearElement,
  GearLabel,
  GroupElement,
  Point,
  RectangleElement,
  RotationInteraction,
  ShapeElement,
  ShapeInteraction,
  isGearElement,
  isGroupElement,
  isRectangleElement,
  isShapeElement,
} from '../models/element.model';
import { Layer } from '../models/layer.model';
import { ProjectStateService } from '../services/project-state.service';
import { createGearPath } from '../utils/gear.utils';
import { createPolygonPath, createTrianglePath, roundedRectPath } from '../utils/geometry.utils';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragState =
  | { kind: 'move'; elementId: string; last: { x: number; y: number } }
  | { kind: 'rotate'; elementId: string; lastAngle: number }
  | { kind: 'rotate-interaction'; elementId: string; interactionId: string; lastAngle: number }
  | { kind: 'slide-interaction'; elementId: string; interactionId: string; last: Point }
  | {
      kind: 'move-interaction-point';
      elementId: string;
      interactionId: string;
      point: 'pivot' | 'start' | 'end';
      last: Point;
    }
  | {
      kind: 'resize-rectangle';
      elementId: string;
      handle: ResizeHandle;
      startPointer: { x: number; y: number };
      start: { x: number; y: number; width: number; height: number; rotation: number };
    };

interface RenderSegment {
  id: string;
  elements: DesignElement[];
  subtractiveElements: DesignElement[];
}

@Component({
  selector: 'app-canvas-stage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './canvas-stage.component.html',
  styleUrl: './canvas-stage.component.css',
})
export class CanvasStageComponent {
  @ViewChild('scene', { static: false }) private readonly scene?: ElementRef<SVGSVGElement>;

  readonly projectChanged = output<void>();

  readonly state = inject(ProjectStateService);
  readonly resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  readonly math = Math;

  private dragState: DragState | null = null;

  getSvgElement(): SVGSVGElement | null {
    return this.scene?.nativeElement ?? null;
  }

  onElementPointerDown(event: PointerEvent, element: DesignElement, layer: Layer): void {
    event.stopPropagation();

    if (this.state.mode() !== 'edit') {
      return;
    }

    if (layer.locked || element.locked || !layer.visible || !element.visible) {
      return;
    }

    this.state.selectElement(element.id);
    this.dragState = {
      kind: 'move',
      elementId: element.id,
      last: this.pointerToSvgPoint(event),
    };
  }

  onRectangleResizePointerDown(
    event: PointerEvent,
    element: RectangleElement,
    handle: ResizeHandle,
  ): void {
    event.stopPropagation();

    if (this.state.mode() !== 'edit') {
      return;
    }

    const found = this.state.findElement(element.id);
    if (
      !found ||
      found.layer.locked ||
      element.locked ||
      !found.layer.visible ||
      !element.visible
    ) {
      return;
    }

    this.state.selectElement(element.id);
    this.dragState = {
      kind: 'resize-rectangle',
      elementId: element.id,
      handle,
      startPointer: this.pointerToSvgPoint(event),
      start: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
      },
    };
  }

  onViewElementPointerDown(event: PointerEvent, element: DesignElement): void {
    if (this.state.mode() !== 'view' || !isShapeElement(element)) {
      return;
    }

    const interaction = (element.interactions ?? []).find((candidate) => candidate.visible);
    if (!interaction) {
      return;
    }

    event.stopPropagation();
    if (interaction.type === 'rotation') {
      this.dragState = {
        kind: 'rotate-interaction',
        elementId: element.id,
        interactionId: interaction.id,
        lastAngle: this.pointerAngleFromPoint(event, {
          x: interaction.pivotX,
          y: interaction.pivotY,
        }),
      };
      return;
    }

    this.dragState = {
      kind: 'slide-interaction',
      elementId: element.id,
      interactionId: interaction.id,
      last: this.pointerToSvgPoint(event),
    };
  }

  onInteractionPointPointerDown(
    event: PointerEvent,
    element: ShapeElement,
    interaction: ShapeInteraction,
    point: 'pivot' | 'start' | 'end',
  ): void {
    event.stopPropagation();

    if (
      this.state.mode() !== 'edit' ||
      element.locked ||
      !element.visible ||
      !interaction.visible
    ) {
      return;
    }

    this.state.selectElement(element.id);
    this.dragState = {
      kind: 'move-interaction-point',
      elementId: element.id,
      interactionId: interaction.id,
      point,
      last: this.pointerToSvgPoint(event),
    };
  }

  onSvgPointerMove(event: PointerEvent): void {
    if (!this.dragState) {
      return;
    }

    if (this.dragState.kind === 'move') {
      const point = this.pointerToSvgPoint(event);
      this.state.moveElementInEditMode(
        this.dragState.elementId,
        point.x - this.dragState.last.x,
        point.y - this.dragState.last.y,
      );
      this.dragState = { ...this.dragState, last: point };
      this.projectChanged.emit();
      return;
    }

    if (this.dragState.kind === 'resize-rectangle') {
      this.resizeRectangleFromPointer(event, this.dragState);
      this.projectChanged.emit();
      return;
    }

    if (this.dragState.kind === 'move-interaction-point') {
      this.moveInteractionPointFromPointer(event, this.dragState);
      this.projectChanged.emit();
      return;
    }

    if (this.dragState.kind === 'rotate-interaction') {
      const dragState = this.dragState;
      const found = this.state.findElement(this.dragState.elementId);
      if (!found || !isShapeElement(found.element)) {
        return;
      }
      const interaction = (found.element.interactions ?? []).find(
        (candidate): candidate is RotationInteraction =>
          candidate.id === dragState.interactionId && candidate.type === 'rotation',
      );
      if (!interaction) {
        return;
      }
      const angle = this.pointerAngleFromPoint(event, {
        x: interaction.pivotX,
        y: interaction.pivotY,
      });
      this.state.rotateElementAroundPivotInViewMode(
        this.dragState.elementId,
        this.dragState.interactionId,
        angle - this.dragState.lastAngle,
      );
      this.dragState = { ...this.dragState, lastAngle: angle };
      this.projectChanged.emit();
      return;
    }

    if (this.dragState.kind === 'slide-interaction') {
      const point = this.pointerToSvgPoint(event);
      this.state.slideElementAlongAxisInViewMode(
        this.dragState.elementId,
        this.dragState.interactionId,
        point.x - this.dragState.last.x,
        point.y - this.dragState.last.y,
      );
      this.dragState = { ...this.dragState, last: point };
      this.projectChanged.emit();
      return;
    }

    if (this.dragState.kind === 'rotate') {
      const found = this.state.findElement(this.dragState.elementId);
      if (!found || !isGearElement(found.element)) {
        return;
      }

      const angle = this.pointerAngle(event, found.element);
      this.state.rotateGearInViewMode(this.dragState.elementId, angle - this.dragState.lastAngle);
      this.dragState = { ...this.dragState, lastAngle: angle };
      this.projectChanged.emit();
    }
  }

  onSvgPointerUp(): void {
    this.dragState = null;
  }

  onSvgPointerDown(event: PointerEvent): void {
    if (this.state.mode() !== 'edit') {
      return;
    }

    const hit = this.findSubtractiveElementAtPointer(event);
    if (hit) {
      this.onElementPointerDown(event, hit.element, hit.layer);
      return;
    }

    this.state.selectElement(null);
  }

  clearSelection(): void {
    if (this.state.mode() === 'edit') {
      this.state.selectElement(null);
    }
  }

  segmentMaskId(segment: RenderSegment): string {
    return `mask-${segment.id}`;
  }

  segmentAdditiveMaskId(segment: RenderSegment): string {
    return `additive-mask-${segment.id}`;
  }

  backgroundPatternId(element: DesignElement): string {
    return `background-${element.id}`;
  }

  shapeFill(element: DesignElement): string | null {
    return isShapeElement(element)
      ? element.backgroundImage
        ? `url(#${this.backgroundPatternId(element)})`
        : element.fill
      : null;
  }

  shapeStroke(element: DesignElement): string | null {
    return isShapeElement(element) ? element.stroke : null;
  }

  shapeStrokeWidth(element: DesignElement): number | null {
    return isShapeElement(element) ? element.strokeWidth : null;
  }

  elementTransform(element: DesignElement, includeRuntimeRotation = false): string {
    const rotation =
      element.rotation +
      (includeRuntimeRotation && isGearElement(element) ? element.currentRotation : 0);
    return `translate(${element.x} ${element.y}) rotate(${rotation})`;
  }

  elementPath(element: DesignElement): string {
    switch (element.type) {
      case 'rectangle':
        return roundedRectPath(element.width, element.height, element.radius ?? 0);
      case 'triangle':
        return createTrianglePath(element.width, element.height);
      case 'polygon':
        return createPolygonPath(element.points);
      case 'gear':
        return createGearPath(element);
      case 'circle':
      case 'text':
      case 'group':
        return '';
    }
  }

  rectangleTransform(element: RectangleElement): string {
    return `translate(${element.x + element.width / 2} ${element.y + element.height / 2}) rotate(${element.rotation}) translate(${-element.width / 2} ${-element.height / 2})`;
  }

  renderTransform(element: DesignElement): string {
    return element.type === 'rectangle'
      ? this.rectangleTransform(element)
      : this.elementTransform(element, true);
  }

  elementCenter(element: DesignElement): Point {
    switch (element.type) {
      case 'rectangle':
      case 'triangle':
        return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
      case 'circle':
      case 'gear':
      case 'text':
      case 'group':
        return { x: element.x, y: element.y };
      case 'polygon': {
        if (element.points.length === 0) {
          return { x: element.x, y: element.y };
        }
        const minX = Math.min(...element.points.map((point) => point.x));
        const maxX = Math.max(...element.points.map((point) => point.x));
        const minY = Math.min(...element.points.map((point) => point.y));
        const maxY = Math.max(...element.points.map((point) => point.y));
        return { x: element.x + (minX + maxX) / 2, y: element.y + (minY + maxY) / 2 };
      }
    }
  }

  labelTransform(gear: GearElement, label: GearLabel): string {
    const x = Math.cos((label.angle * Math.PI) / 180) * (gear.discRadius - label.offsetFromEdge);
    const y = Math.sin((label.angle * Math.PI) / 180) * (gear.discRadius - label.offsetFromEdge);
    return `rotate(${label.rotation} ${x} ${y})`;
  }

  isAdditiveVisible(element: DesignElement): boolean {
    return element.visible && element.mode === 'additive' && !isGroupElement(element);
  }

  isSubtractiveVisible(element: DesignElement): boolean {
    return (
      element.visible &&
      element.mode === 'subtractive' &&
      !isGroupElement(element) &&
      (element.type === 'circle' || this.elementPath(element) !== '')
    );
  }

  isSelected(element: DesignElement): boolean {
    return this.state.selectedElementId() === element.id;
  }

  isGear(element: DesignElement): element is GearElement {
    return isGearElement(element);
  }

  isGroup(element: DesignElement): element is GroupElement {
    return isGroupElement(element);
  }

  isRectangle(element: DesignElement): element is RectangleElement {
    return isRectangleElement(element);
  }

  isShape(element: DesignElement): element is ShapeElement {
    return isShapeElement(element);
  }

  visibleShapeElements(elements: DesignElement[]): ShapeElement[] {
    return this.allElements(elements).filter(
      (element): element is ShapeElement =>
        isShapeElement(element) &&
        element.visible &&
        (element.interactions ?? []).some((interaction) => interaction.visible),
    );
  }

  allElements(elements: DesignElement[]): DesignElement[] {
    return elements.flatMap((element) =>
      isGroupElement(element) ? [element, ...this.allElements(element.elements)] : [element],
    );
  }

  renderSegments(layer: Layer): RenderSegment[] {
    const elements = this.allElements(layer.elements);
    const segments: RenderSegment[] = [];
    let currentAdditiveElements: DesignElement[] = [];

    elements.forEach((element, index) => {
      if (this.isSubtractiveVisible(element)) {
        if (currentAdditiveElements.length > 0) {
          segments.push({
            id: `${layer.id}-${segments.length}`,
            elements: currentAdditiveElements,
            subtractiveElements: elements.slice(index).filter((candidate) =>
              this.isSubtractiveVisible(candidate),
            ),
          });
          currentAdditiveElements = [];
        }
        return;
      }

      if (this.isAdditiveVisible(element)) {
        currentAdditiveElements.push(element);
      }
    });

    if (currentAdditiveElements.length > 0) {
      segments.push({
        id: `${layer.id}-${segments.length}`,
        elements: currentAdditiveElements,
        subtractiveElements: [],
      });
    }

    return segments;
  }

  resizeHandleX(element: RectangleElement, handle: ResizeHandle): number {
    if (handle.includes('w')) {
      return 0;
    }
    return handle.includes('e') ? element.width : element.width / 2;
  }

  resizeHandleY(element: RectangleElement, handle: ResizeHandle): number {
    if (handle.includes('n')) {
      return 0;
    }
    return handle.includes('s') ? element.height : element.height / 2;
  }

  resizeCursor(handle: ResizeHandle): string {
    return `${handle}-resize`;
  }

  private resizeRectangleFromPointer(
    event: PointerEvent,
    dragState: Extract<DragState, { kind: 'resize-rectangle' }>,
  ): void {
    const found = this.state.findElement(dragState.elementId);
    if (!found || !isRectangleElement(found.element)) {
      return;
    }

    const point = this.pointerToSvgPoint(event);
    const dx = point.x - dragState.startPointer.x;
    const dy = point.y - dragState.startPointer.y;
    const radians = (dragState.start.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;
    const handle = dragState.handle;
    const minSize = 2;

    const requestedWidth =
      handle.includes('e') || handle.includes('w')
        ? dragState.start.width + (handle.includes('e') ? localDx : -localDx)
        : dragState.start.width;
    const requestedHeight =
      handle.includes('n') || handle.includes('s')
        ? dragState.start.height + (handle.includes('s') ? localDy : -localDy)
        : dragState.start.height;
    const width = Math.max(minSize, requestedWidth);
    const height = Math.max(minSize, requestedHeight);

    const centerShiftLocalX = handle.includes('e')
      ? (width - dragState.start.width) / 2
      : handle.includes('w')
        ? (dragState.start.width - width) / 2
        : 0;
    const centerShiftLocalY = handle.includes('s')
      ? (height - dragState.start.height) / 2
      : handle.includes('n')
        ? (dragState.start.height - height) / 2
        : 0;

    const centerX = dragState.start.x + dragState.start.width / 2;
    const centerY = dragState.start.y + dragState.start.height / 2;
    const shiftedCenterX = centerX + centerShiftLocalX * cos - centerShiftLocalY * sin;
    const shiftedCenterY = centerY + centerShiftLocalX * sin + centerShiftLocalY * cos;

    this.state.updateElement(dragState.elementId, {
      x: shiftedCenterX - width / 2,
      y: shiftedCenterY - height / 2,
      width,
      height,
    } as Partial<RectangleElement>);
  }

  private pointerToSvgPoint(event: PointerEvent): { x: number; y: number } {
    const svg = this.scene?.nativeElement;
    if (!svg) {
      return { x: 0, y: 0 };
    }

    const rect = svg.getBoundingClientRect();
    const canvas = this.state.project().canvas;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  private pointerAngle(event: PointerEvent, element: DesignElement): number {
    const point = this.pointerToSvgPoint(event);
    return (Math.atan2(point.y - element.y, point.x - element.x) * 180) / Math.PI;
  }

  private moveInteractionPointFromPointer(
    event: PointerEvent,
    dragState: Extract<DragState, { kind: 'move-interaction-point' }>,
  ): void {
    const found = this.state.findElement(dragState.elementId);
    if (!found || !isShapeElement(found.element)) {
      return;
    }

    const point = this.pointerToSvgPoint(event);
    const dx = point.x - dragState.last.x;
    const dy = point.y - dragState.last.y;
    const interaction = (found.element.interactions ?? []).find(
      (candidate) => candidate.id === dragState.interactionId,
    );
    if (!interaction) {
      return;
    }

    if (interaction.type === 'rotation' && dragState.point === 'pivot') {
      this.state.updateElementInteraction(found.element.id, interaction.id, {
        pivotX: interaction.pivotX + dx,
        pivotY: interaction.pivotY + dy,
      });
    }

    if (interaction.type === 'slide' && dragState.point === 'start') {
      this.state.updateElementInteraction(found.element.id, interaction.id, {
        startX: interaction.startX + dx,
        startY: interaction.startY + dy,
      });
    }

    if (interaction.type === 'slide' && dragState.point === 'end') {
      this.state.updateElementInteraction(found.element.id, interaction.id, {
        endX: interaction.endX + dx,
        endY: interaction.endY + dy,
      });
    }

    this.dragState = { ...dragState, last: point };
  }

  private pointerAngleFromPoint(event: PointerEvent, point: Point): number {
    const pointer = this.pointerToSvgPoint(event);
    return (Math.atan2(pointer.y - point.y, pointer.x - point.x) * 180) / Math.PI;
  }

  private findSubtractiveElementAtPointer(
    event: PointerEvent,
  ): { layer: Layer; element: DesignElement } | null {
    const point = this.pointerToSvgPoint(event);
    const layers = [...this.state.visibleLayers()].reverse();

    for (const layer of layers) {
      if (layer.locked || !layer.visible) {
        continue;
      }

      const elements = [...this.allElements(layer.elements)].reverse();
      for (const element of elements) {
        if (
          this.isSubtractiveVisible(element) &&
          !element.locked &&
          this.isPointInsideElement(point, element)
        ) {
          return { layer, element };
        }
      }
    }

    return null;
  }

  private isPointInsideElement(point: Point, element: DesignElement): boolean {
    const localPoint = this.toElementLocalPoint(point, element);

    switch (element.type) {
      case 'circle':
        return localPoint.x ** 2 + localPoint.y ** 2 <= element.radius ** 2;
      case 'rectangle':
        return (
          localPoint.x >= 0 &&
          localPoint.y >= 0 &&
          localPoint.x <= element.width &&
          localPoint.y <= element.height
        );
      case 'triangle':
      case 'polygon':
      case 'gear':
        return this.isPointInsidePath(localPoint, this.elementPath(element));
      case 'text':
      case 'group':
        return false;
    }
  }

  private toElementLocalPoint(point: Point, element: DesignElement): Point {
    if (isRectangleElement(element)) {
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      const radians = (-element.rotation * Math.PI) / 180;
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      return {
        x: dx * Math.cos(radians) - dy * Math.sin(radians) + element.width / 2,
        y: dx * Math.sin(radians) + dy * Math.cos(radians) + element.height / 2,
      };
    }

    const rotation = element.rotation + (isGearElement(element) ? element.currentRotation : 0);
    const radians = (-rotation * Math.PI) / 180;
    const dx = point.x - element.x;
    const dy = point.y - element.y;
    return {
      x: dx * Math.cos(radians) - dy * Math.sin(radians),
      y: dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  }

  private isPointInsidePath(point: Point, pathData: string): boolean {
    if (!pathData) {
      return false;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    return path.isPointInFill(new DOMPoint(point.x, point.y));
  }
}
