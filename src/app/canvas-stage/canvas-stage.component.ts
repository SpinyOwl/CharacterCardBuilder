import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, output } from '@angular/core';
import {
  DesignElement,
  GearElement,
  GearLabel,
  GroupElement,
  Point,
  RectangleElement,
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
  | { kind: 'slide'; elementId: string; lastProjection: number }
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

  onGearViewPointerDown(event: PointerEvent, element: DesignElement): void {
    if (this.state.mode() !== 'view') {
      return;
    }

    event.stopPropagation();
    if (element.rotationPoint) {
      this.dragState = {
        kind: 'rotate',
        elementId: element.id,
        lastAngle: this.pointerAngle(event, element),
      };
      return;
    }
    if (element.slideAxis) {
      this.dragState = {
        kind: 'slide',
        elementId: element.id,
        lastProjection: this.pointerProjection(event, element),
      };
    }
  }

  onGearWheel(event: WheelEvent, element: DesignElement): void {
    if (this.state.mode() !== 'view' || !element.rotationPoint) {
      return;
    }

    event.preventDefault();
    this.state.rotateElementInViewMode(element.id, event.deltaY > 0 ? 6 : -6);
    this.projectChanged.emit();
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

    const found = this.state.findElement(this.dragState.elementId);
    if (!found) {
      return;
    }
    if (this.dragState.kind === 'rotate') {
      const angle = this.pointerAngle(event, found.element);
      this.state.rotateElementInViewMode(this.dragState.elementId, angle - this.dragState.lastAngle);
      this.dragState = { ...this.dragState, lastAngle: angle };
    } else {
      const projection = this.pointerProjection(event, found.element);
      this.state.slideElementInViewMode(this.dragState.elementId, projection - this.dragState.lastProjection);
      this.dragState = { ...this.dragState, lastProjection: projection };
    }
    this.projectChanged.emit();
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
    const runtimeRotation = includeRuntimeRotation ? (element.currentRotation ?? 0) : 0;
    const rotation = element.rotation + runtimeRotation;
    const slide = includeRuntimeRotation ? this.elementSlide(element) : { x: 0, y: 0 };
    return `translate(${element.x + slide.x} ${element.y + slide.y}) rotate(${rotation})`;
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
    const pivot = element.rotationPoint
      ? { x: element.x + element.rotationPoint.x, y: element.y + element.rotationPoint.y }
      : { x: element.x, y: element.y };
    return (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;
  }

  private pointerProjection(event: PointerEvent, element: DesignElement): number {
    const axis = element.slideAxis ?? { x: 1, y: 0 };
    const length = Math.hypot(axis.x, axis.y) || 1;
    const unit = { x: axis.x / length, y: axis.y / length };
    const point = this.pointerToSvgPoint(event);
    return point.x * unit.x + point.y * unit.y;
  }

  private elementSlide(element: DesignElement): Point {
    const axis = element.slideAxis;
    if (!axis || !element.currentSlide) {
      return { x: 0, y: 0 };
    }
    const length = Math.hypot(axis.x, axis.y) || 1;
    return {
      x: (axis.x / length) * element.currentSlide,
      y: (axis.y / length) * element.currentSlide,
    };
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

    const rotation = element.rotation + (element.currentRotation ?? 0);
    const slide = this.elementSlide(element);
    const radians = (-rotation * Math.PI) / 180;
    const dx = point.x - (element.x + slide.x);
    const dy = point.y - (element.y + slide.y);
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
