import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, output } from '@angular/core';
import {
  DesignElement,
  GearElement,
  GroupElement,
  RectangleElement,
  isGearElement,
  isGroupElement,
  isRectangleElement,
} from '../models/element.model';
import { Layer } from '../models/layer.model';
import { ProjectStateService } from '../services/project-state.service';
import { createGearPath } from '../utils/gear.utils';
import { createPolygonPath, createTrianglePath, roundedRectPath } from '../utils/geometry.utils';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragState =
  | { kind: 'move'; elementId: string; last: { x: number; y: number } }
  | { kind: 'rotate'; elementId: string; lastAngle: number }
  | {
      kind: 'resize-rectangle';
      elementId: string;
      handle: ResizeHandle;
      startPointer: { x: number; y: number };
      start: { x: number; y: number; width: number; height: number; rotation: number };
    };

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
    if (this.state.mode() !== 'view' || !isGearElement(element)) {
      return;
    }

    event.stopPropagation();
    this.dragState = {
      kind: 'rotate',
      elementId: element.id,
      lastAngle: this.pointerAngle(event, element),
    };
  }

  onGearWheel(event: WheelEvent, element: DesignElement): void {
    if (this.state.mode() !== 'view' || !isGearElement(element)) {
      return;
    }

    event.preventDefault();
    this.state.rotateGearInViewMode(element.id, event.deltaY > 0 ? 6 : -6);
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
    if (!found || !isGearElement(found.element)) {
      return;
    }

    const angle = this.pointerAngle(event, found.element);
    this.state.rotateGearInViewMode(this.dragState.elementId, angle - this.dragState.lastAngle);
    this.dragState = { ...this.dragState, lastAngle: angle };
    this.projectChanged.emit();
  }

  onSvgPointerUp(): void {
    this.dragState = null;
  }

  clearSelection(): void {
    if (this.state.mode() === 'edit') {
      this.state.selectElement(null);
    }
  }

  layerMaskId(layer: Layer): string {
    return `mask-${layer.id}`;
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

  isAdditiveVisible(element: DesignElement): boolean {
    return element.visible && element.mode === 'additive' && !isGroupElement(element);
  }

  isSubtractiveRectangle(element: DesignElement): element is RectangleElement {
    return element.visible && element.mode === 'subtractive' && isRectangleElement(element);
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
}
