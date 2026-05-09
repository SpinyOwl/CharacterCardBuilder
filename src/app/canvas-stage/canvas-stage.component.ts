import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, ViewChild, inject, output } from '@angular/core';
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
  isShapeElement,
} from '../models/element.model';
import { Layer } from '../models/layer.model';
import { AppSettingsService } from '../services/app-settings.service';
import { ProjectStateService } from '../services/project-state.service';
import { CanvasViewMode } from '../services/app-settings.service';
import { createGearPath } from '../utils/gear.utils';
import { createPolygonPath, createTrianglePath, roundedRectPath } from '../utils/geometry.utils';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragState =
  | {
      kind: 'move';
      elementId: string;
      startPointer: Point;
      start: { x: number; y: number };
    }
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
      kind: 'resize-shape';
      elementId: string;
      handle: ResizeHandle;
      startPointer: { x: number; y: number };
      startBox: SelectionBox;
      startElement: ShapeElement;
    };

interface RenderSegment {
  id: string;
  elements: DesignElement[];
  subtractiveElements: DesignElement[];
}

interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

@Component({
  selector: 'app-canvas-stage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './canvas-stage.component.html',
  styleUrl: './canvas-stage.component.css',
})
export class CanvasStageComponent {
  @Input() stickyPointsEnabled = false;
  @Input() gridEnabled = false;
  @Input() gridSize = 5;
  @Input() canvasViewMode: CanvasViewMode = 'fit';
  @Input() canvasScale = 1;
  @ViewChild('scene', { static: false }) private readonly scene?: ElementRef<SVGSVGElement>;

  readonly projectChanged = output<void>();

  readonly state = inject(ProjectStateService);
  readonly appSettings = inject(AppSettingsService);
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

    const hit = this.findEditableElementAtPointer(event) ?? { element, layer };
    if (hit.layer.locked || hit.element.locked || !hit.layer.visible || !hit.element.visible) {
      return;
    }

    this.state.selectElement(hit.element.id);
    this.dragState = {
      kind: 'move',
      elementId: hit.element.id,
      startPointer: this.pointerToSvgPoint(event),
      start: { x: hit.element.x, y: hit.element.y },
    };
  }

  onShapeResizePointerDown(
    event: PointerEvent,
    element: ShapeElement,
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
      kind: 'resize-shape',
      elementId: element.id,
      handle,
      startPointer: this.pointerToSvgPoint(event),
      startBox: this.selectionBox(element),
      startElement: structuredClone(element),
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
          ...this.interactionPointToWorld(element, interaction, 'pivot'),
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
      this.moveElementFromPointer(event, this.dragState);
      this.projectChanged.emit();
      return;
    }

    if (this.dragState.kind === 'resize-shape') {
      this.resizeShapeFromPointer(event, this.dragState);
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
        ...this.interactionPointToWorld(found.element, interaction, 'pivot'),
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

    const hit = this.findEditableElementAtPointer(event);
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

  backgroundPatternSize(element: DesignElement): number {
    return isShapeElement(element) && element.backgroundRepeat === 'repeat'
      ? 1 / Math.max(0.05, element.backgroundScale ?? 1)
      : 1;
  }

  backgroundImageSize(element: DesignElement): number {
    return isShapeElement(element)
      ? this.backgroundPatternSize(element) * Math.max(0.05, element.backgroundScale ?? 1)
      : 1;
  }

  backgroundImageOffset(element: DesignElement, axis: 'x' | 'y'): number {
    if (!isShapeElement(element)) {
      return 0;
    }
    const scale = Math.max(0.05, element.backgroundScale ?? 1);
    const position = axis === 'x' ? element.backgroundPositionX ?? 0 : element.backgroundPositionY ?? 0;
    const patternSize = this.backgroundPatternSize(element);
    const availableSpace = element.backgroundRepeat === 'repeat' ? patternSize : 1 - scale;
    return (position / 100) * availableSpace;
  }

  backgroundPatternTransform(element: DesignElement): string | null {
    if (!isShapeElement(element)) {
      return null;
    }
    const rotation = element.backgroundRotation ?? 0;
    return rotation === 0 ? null : `rotate(${rotation} 0.5 0.5)`;
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
    const viewTransform = this.state.elementViewTransform(element);
    const rotation =
      viewTransform.rotation +
      (includeRuntimeRotation && isGearElement(element) ? element.currentRotation : 0);
    return `translate(${viewTransform.x} ${viewTransform.y}) rotate(${rotation})`;
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
    const viewTransform = this.state.elementViewTransform(element);
    return `translate(${viewTransform.x + element.width / 2} ${viewTransform.y + element.height / 2}) rotate(${viewTransform.rotation}) translate(${-element.width / 2} ${-element.height / 2})`;
  }

  renderTransform(element: DesignElement): string {
    return element.type === 'rectangle'
      ? this.rectangleTransform(element)
      : this.elementTransform(element, true);
  }

  selectionBoxTransform(element: DesignElement): string {
    const box = this.selectionBox(element);
    return `translate(${box.x} ${box.y}) rotate(${box.rotation})`;
  }

  selectionBox(element: DesignElement): SelectionBox {
    switch (element.type) {
      case 'rectangle':
        return {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
        };
      case 'triangle':
        return {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
        };
      case 'circle':
        return {
          x: element.x - element.radius,
          y: element.y - element.radius,
          width: element.radius * 2,
          height: element.radius * 2,
          rotation: element.rotation,
        };
      case 'gear': {
        const radius = element.discRadius + element.toothHeight;
        return {
          x: element.x - radius,
          y: element.y - radius,
          width: radius * 2,
          height: radius * 2,
          rotation: element.rotation + element.currentRotation,
        };
      }
      case 'polygon': {
        const points = element.points.length > 0 ? element.points : [{ x: 0, y: 0 }];
        const minX = Math.min(...points.map((point) => point.x));
        const minY = Math.min(...points.map((point) => point.y));
        const maxX = Math.max(...points.map((point) => point.x));
        const maxY = Math.max(...points.map((point) => point.y));
        return {
          x: element.x + minX,
          y: element.y + minY,
          width: maxX - minX,
          height: maxY - minY,
          rotation: element.rotation,
        };
      }
      case 'text':
        return {
          x: element.x,
          y: element.y - element.fontSize,
          width: element.text.length * element.fontSize * 0.55,
          height: element.fontSize,
          rotation: element.rotation,
        };
      case 'group':
        return { x: element.x, y: element.y, width: 0, height: 0, rotation: element.rotation };
    }
  }

  elementCenter(element: DesignElement): Point {
    const viewTransform = this.state.elementViewTransform(element);
    switch (element.type) {
      case 'rectangle':
      case 'triangle':
        return { x: viewTransform.x + element.width / 2, y: viewTransform.y + element.height / 2 };
      case 'circle':
      case 'gear':
      case 'text':
      case 'group':
        return { x: viewTransform.x, y: viewTransform.y };
      case 'polygon': {
        if (element.points.length === 0) {
          return { x: viewTransform.x, y: viewTransform.y };
        }
        const minX = Math.min(...element.points.map((point) => point.x));
        const maxX = Math.max(...element.points.map((point) => point.x));
        const minY = Math.min(...element.points.map((point) => point.y));
        const maxY = Math.max(...element.points.map((point) => point.y));
        return {
          x: viewTransform.x + (minX + maxX) / 2,
          y: viewTransform.y + (minY + maxY) / 2,
        };
      }
    }
  }

  interactionPointToWorld(
    element: ShapeElement,
    interaction: ShapeInteraction,
    point: 'pivot' | 'start' | 'end',
  ): Point {
    if (interaction.type === 'rotation') {
      return this.elementLocalPointToWorld(element, {
        x: interaction.pivotX,
        y: interaction.pivotY,
      });
    }

    return this.elementLocalPointToWorld(element, {
      x: point === 'start' ? interaction.startX : interaction.endX,
      y: point === 'start' ? interaction.startY : interaction.endY,
    });
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
    return element.type === 'rectangle';
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

  resizeHandleX(box: Pick<SelectionBox, 'width'>, handle: ResizeHandle): number {
    if (handle.includes('w')) {
      return 0;
    }
    return handle.includes('e') ? box.width : box.width / 2;
  }

  resizeHandleY(box: Pick<SelectionBox, 'height'>, handle: ResizeHandle): number {
    if (handle.includes('n')) {
      return 0;
    }
    return handle.includes('s') ? box.height : box.height / 2;
  }

  resizeCursor(handle: ResizeHandle): string {
    return `${handle}-resize`;
  }

  resizeHandleOffset(): number {
    return this.appSettings.selectionHandleSize() / 2;
  }

  gridPatternId(): string {
    return 'editor-grid-pattern';
  }

  normalizedGridSize(): number {
    return Number.isFinite(this.gridSize) && this.gridSize > 0 ? this.gridSize : 5;
  }

  gridPath(): string {
    const size = this.normalizedGridSize();
    return `M ${size} 0 L 0 0 0 ${size}`;
  }

  showGrid(): boolean {
    return this.gridEnabled && this.state.mode() === 'edit';
  }

  isFitCanvasView(): boolean {
    return this.canvasViewMode === 'fit';
  }

  normalizedCanvasScale(): number {
    return Number.isFinite(this.canvasScale)
      ? Math.min(4, Math.max(0.25, this.canvasScale))
      : 1;
  }

  scaledCanvasWidthMm(): number | null {
    return this.isFitCanvasView()
      ? null
      : this.state.project().canvas.width * this.normalizedCanvasScale();
  }

  scaledCanvasHeightMm(): number | null {
    return this.isFitCanvasView()
      ? null
      : this.state.project().canvas.height * this.normalizedCanvasScale();
  }

  private moveElementFromPointer(
    event: PointerEvent,
    dragState: Extract<DragState, { kind: 'move' }>,
  ): void {
    const found = this.state.findElement(dragState.elementId);
    if (!found) {
      return;
    }

    const point = this.pointerToSvgPoint(event);
    const target = this.snapToGrid({
      x: dragState.start.x + point.x - dragState.startPointer.x,
      y: dragState.start.y + point.y - dragState.startPointer.y,
    });
    this.state.moveElementInEditMode(
      dragState.elementId,
      target.x - found.element.x,
      target.y - found.element.y,
    );
  }

  private resizeShapeFromPointer(
    event: PointerEvent,
    dragState: Extract<DragState, { kind: 'resize-shape' }>,
  ): void {
    const found = this.state.findElement(dragState.elementId);
    if (!found || !isShapeElement(found.element)) {
      return;
    }

    const box = this.resizeBoxFromPointer(event, dragState);
    const patch = this.shapeResizePatch(dragState.startElement, box, dragState.handle);
    this.state.updateElement(dragState.elementId, patch as Partial<ShapeElement>);
  }

  private resizeBoxFromPointer(
    event: PointerEvent,
    dragState: Extract<DragState, { kind: 'resize-shape' }>,
  ): SelectionBox {
    const point = this.pointerToSvgPoint(event);
    const dx = point.x - dragState.startPointer.x;
    const dy = point.y - dragState.startPointer.y;
    const start = dragState.startBox;
    const radians = (start.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;
    const handle = dragState.handle;
    const minSize = 2;

    const requestedWidth =
      handle.includes('e') || handle.includes('w')
        ? start.width + (handle.includes('e') ? localDx : -localDx)
        : start.width;
    const requestedHeight =
      handle.includes('n') || handle.includes('s')
        ? start.height + (handle.includes('s') ? localDy : -localDy)
        : start.height;
    const constrainedSize = this.constrainResizeDimensions(
      dragState.startElement,
      Math.max(minSize, requestedWidth),
      Math.max(minSize, requestedHeight),
      event.shiftKey,
    );
    const width = constrainedSize.width;
    const height = constrainedSize.height;

    const centerShiftLocalX = handle.includes('e')
      ? (width - start.width) / 2
      : handle.includes('w')
        ? (start.width - width) / 2
        : 0;
    const centerShiftLocalY = handle.includes('s')
      ? (height - start.height) / 2
      : handle.includes('n')
        ? (start.height - height) / 2
        : 0;

    const centerX = start.x + start.width / 2;
    const centerY = start.y + start.height / 2;
    const shiftedCenterX = centerX + centerShiftLocalX * cos - centerShiftLocalY * sin;
    const shiftedCenterY = centerY + centerShiftLocalX * sin + centerShiftLocalY * cos;

    const resized = this.snapRectangleToGrid({
      x: shiftedCenterX - width / 2,
      y: shiftedCenterY - height / 2,
      width,
      height,
    });

    return { ...resized, rotation: start.rotation };
  }

  private shapeResizePatch(
    element: ShapeElement,
    box: SelectionBox,
    handle: ResizeHandle,
  ): Partial<ShapeElement> {
    switch (element.type) {
      case 'rectangle':
      case 'triangle':
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        } as Partial<ShapeElement>;
      case 'circle': {
        const square = this.squareResizeBox(element, box, handle);
        return {
          x: square.x + square.width / 2,
          y: square.y + square.height / 2,
          radius: square.width / 2,
        } as Partial<ShapeElement>;
      }
      case 'gear': {
        const square = this.squareResizeBox(element, box, handle);
        const oldOuterRadius = Math.max(1, element.discRadius + element.toothHeight);
        const scale = square.width / 2 / oldOuterRadius;
        return {
          x: square.x + square.width / 2,
          y: square.y + square.height / 2,
          discRadius: Math.max(1, element.discRadius * scale),
          toothHeight: Math.max(0.5, element.toothHeight * scale),
          centerDotRadius: Math.max(0.3, element.centerDotRadius * scale),
        } as Partial<ShapeElement>;
      }
      case 'polygon':
        return this.polygonResizePatch(element, box) as Partial<ShapeElement>;
    }
  }

  private constrainResizeDimensions(
    element: ShapeElement,
    width: number,
    height: number,
    constrainAspectRatio: boolean,
  ): { width: number; height: number } {
    if (!constrainAspectRatio || (element.type !== 'rectangle' && element.type !== 'triangle')) {
      return { width, height };
    }

    const ratio = element.type === 'triangle' ? Math.sqrt(3) / 2 : 1;
    const side = Math.max(width, height / ratio);
    return {
      width: side,
      height: side * ratio,
    };
  }

  private squareResizeBox(
    element: ShapeElement,
    resizedBox: SelectionBox,
    handle: ResizeHandle,
  ): SelectionBox {
    const start = this.selectionBox(element);
    const requestedSize = Math.max(
      2,
      handle.includes('e') || handle.includes('w') ? resizedBox.width : 0,
      handle.includes('n') || handle.includes('s') ? resizedBox.height : 0,
      !/[ewns]/.test(handle) ? start.width : 0,
    );
    const centerX = start.x + start.width / 2;
    const centerY = start.y + start.height / 2;
    const x = handle.includes('w')
      ? start.x + start.width - requestedSize
      : handle.includes('e')
        ? start.x
        : centerX - requestedSize / 2;
    const y = handle.includes('n')
      ? start.y + start.height - requestedSize
      : handle.includes('s')
        ? start.y
        : centerY - requestedSize / 2;
    return { x, y, width: requestedSize, height: requestedSize, rotation: start.rotation };
  }

  private polygonResizePatch(
    element: ShapeElement & { points: Point[] },
    box: SelectionBox,
  ): Partial<ShapeElement> {
    if (element.points.length === 0) {
      return { x: box.x, y: box.y } as Partial<ShapeElement>;
    }

    const minX = Math.min(...element.points.map((point) => point.x));
    const minY = Math.min(...element.points.map((point) => point.y));
    const maxX = Math.max(...element.points.map((point) => point.x));
    const maxY = Math.max(...element.points.map((point) => point.y));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scaleX = box.width / width;
    const scaleY = box.height / height;

    return {
      x: box.x,
      y: box.y,
      points: element.points.map((point) => ({
        x: (point.x - minX) * scaleX,
        y: (point.y - minY) * scaleY,
      })),
    } as Partial<ShapeElement>;
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

  private elementLocalPointToWorld(element: DesignElement, point: Point): Point {
    const viewTransform = this.state.elementViewTransform(element);
    const radians = (viewTransform.rotation * Math.PI) / 180;
    return {
      x: viewTransform.x + point.x * Math.cos(radians) - point.y * Math.sin(radians),
      y: viewTransform.y + point.x * Math.sin(radians) + point.y * Math.cos(radians),
    };
  }

  private worldPointToElementLocal(element: DesignElement, point: Point): Point {
    const viewTransform = this.state.elementViewTransform(element);
    const radians = (-viewTransform.rotation * Math.PI) / 180;
    const dx = point.x - viewTransform.x;
    const dy = point.y - viewTransform.y;
    return {
      x: dx * Math.cos(radians) - dy * Math.sin(radians),
      y: dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  }

  private snapPoint(point: Point): Point {
    if (!this.stickyPointsEnabled) {
      return point;
    }

    const snapDistance = 3;
    const candidates = this.state
      .visibleLayers()
      .flatMap((layer) => this.allElements(layer.elements))
      .filter((element): element is ShapeElement => isShapeElement(element) && element.visible)
      .flatMap((element) => this.shapeSnapPoints(element));
    const nearest = candidates
      .map((candidate) => ({
        point: candidate,
        distance: Math.hypot(candidate.x - point.x, candidate.y - point.y),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return nearest && nearest.distance <= snapDistance ? nearest.point : point;
  }

  private snapToGrid(point: Point): Point {
    if (!this.gridEnabled) {
      return point;
    }

    return {
      x: this.snapNumberToGrid(point.x),
      y: this.snapNumberToGrid(point.y),
    };
  }

  private snapRectangleToGrid(rectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (!this.gridEnabled) {
      return rectangle;
    }

    const minSize = 2;
    return {
      x: this.snapNumberToGrid(rectangle.x),
      y: this.snapNumberToGrid(rectangle.y),
      width: Math.max(minSize, this.snapNumberToGrid(rectangle.width)),
      height: Math.max(minSize, this.snapNumberToGrid(rectangle.height)),
    };
  }

  private snapNumberToGrid(value: number): number {
    const size = this.normalizedGridSize();
    return Math.round(value / size) * size;
  }

  private shapeSnapPoints(element: ShapeElement): Point[] {
    switch (element.type) {
      case 'rectangle':
        return this.rectangleSnapPoints(element);
      case 'triangle':
        return this.triangleSnapPoints(element);
      case 'circle':
        return this.circularSnapPoints(element.x, element.y, element.radius);
      case 'gear':
        return this.gearSnapPoints(element);
      case 'polygon':
        return this.polygonSnapPoints(element);
    }
  }

  private rectangleSnapPoints(element: RectangleElement): Point[] {
    const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
    const points = [
      { x: 0, y: 0 },
      { x: element.width / 2, y: 0 },
      { x: element.width, y: 0 },
      { x: element.width, y: element.height / 2 },
      { x: element.width, y: element.height },
      { x: element.width / 2, y: element.height },
      { x: 0, y: element.height },
      { x: 0, y: element.height / 2 },
      { x: element.width / 2, y: element.height / 2 },
    ];

    return points.map((point) =>
      this.rotatePoint(
        { x: element.x + point.x, y: element.y + point.y },
        center,
        element.rotation,
      ),
    );
  }

  private triangleSnapPoints(element: ShapeElement & { width: number; height: number }): Point[] {
    const vertices = [
      { x: element.width / 2, y: 0 },
      { x: element.width, y: element.height },
      { x: 0, y: element.height },
    ];
    const edgeCenters = vertices.map((point, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
    });
    const center = {
      x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
      y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length,
    };

    return [...vertices, ...edgeCenters, center].map((point) =>
      this.rotatePoint(
        { x: element.x + point.x, y: element.y + point.y },
        { x: element.x, y: element.y },
        element.rotation,
      ),
    );
  }

  private circularSnapPoints(x: number, y: number, radius: number): Point[] {
    const segments = 24;
    return [
      { x, y },
      ...Array.from({ length: segments }, (_, index) => {
        const angle = (index / segments) * Math.PI * 2;
        return {
          x: x + Math.cos(angle) * radius,
          y: y + Math.sin(angle) * radius,
        };
      }),
    ];
  }

  private gearSnapPoints(element: ShapeElement & {
    discRadius: number;
    toothHeight: number;
    teeth: number;
  }): Point[] {
    const safeTeeth = Math.max(3, Math.round(element.teeth));
    const outerRadius = element.discRadius + element.toothHeight;
    const points: Point[] = [{ x: element.x, y: element.y }];

    for (let index = 0; index < safeTeeth; index += 1) {
      const toothAngle = -Math.PI / 2 + (index / safeTeeth) * Math.PI * 2;
      const valleyAngle = toothAngle + Math.PI / safeTeeth;
      points.push(
        {
          x: element.x + Math.cos(toothAngle) * outerRadius,
          y: element.y + Math.sin(toothAngle) * outerRadius,
        },
        {
          x: element.x + Math.cos(valleyAngle) * element.discRadius,
          y: element.y + Math.sin(valleyAngle) * element.discRadius,
        },
      );
    }

    return points.map((point) =>
      this.rotatePoint(point, { x: element.x, y: element.y }, element.rotation),
    );
  }

  private polygonSnapPoints(element: ShapeElement & { points: Point[] }): Point[] {
    if (element.points.length === 0) {
      return [{ x: element.x, y: element.y }];
    }

    const transformedPoints = element.points.map((point) =>
      this.rotatePoint(
        { x: element.x + point.x, y: element.y + point.y },
        { x: element.x, y: element.y },
        element.rotation,
      ),
    );
    const minX = Math.min(...transformedPoints.map((point) => point.x));
    const maxX = Math.max(...transformedPoints.map((point) => point.x));
    const minY = Math.min(...transformedPoints.map((point) => point.y));
    const maxY = Math.max(...transformedPoints.map((point) => point.y));

    return [
      ...transformedPoints,
      { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      { x: (minX + maxX) / 2, y: minY },
      { x: maxX, y: (minY + maxY) / 2 },
      { x: (minX + maxX) / 2, y: maxY },
      { x: minX, y: (minY + maxY) / 2 },
    ];
  }

  private rotatePoint(point: Point, center: Point, rotation: number): Point {
    const radians = (rotation * Math.PI) / 180;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
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

    const point = this.worldPointToElementLocal(
      found.element,
      this.snapPoint(this.pointerToSvgPoint(event)),
    );
    const interaction = (found.element.interactions ?? []).find(
      (candidate) => candidate.id === dragState.interactionId,
    );
    if (!interaction) {
      return;
    }

    if (interaction.type === 'rotation' && dragState.point === 'pivot') {
      this.state.updateElementInteraction(found.element.id, interaction.id, {
        pivotX: point.x,
        pivotY: point.y,
      });
    }

    if (interaction.type === 'slide' && dragState.point === 'start') {
      this.state.updateElementInteraction(found.element.id, interaction.id, {
        startX: point.x,
        startY: point.y,
      });
    }

    if (interaction.type === 'slide' && dragState.point === 'end') {
      this.state.updateElementInteraction(found.element.id, interaction.id, {
        endX: point.x,
        endY: point.y,
      });
    }

    this.dragState = { ...dragState, last: point };
  }

  private pointerAngleFromPoint(event: PointerEvent, point: Point): number {
    const pointer = this.pointerToSvgPoint(event);
    return (Math.atan2(pointer.y - point.y, pointer.x - point.x) * 180) / Math.PI;
  }

  private findEditableElementAtPointer(
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
        if (element.visible && !element.locked && this.isPointInsideElement(point, element)) {
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
        return this.isPointInsideTriangle(localPoint, element.width, element.height);
      case 'polygon':
      case 'gear':
        return this.isPointInsidePath(localPoint, this.elementPath(element));
      case 'text':
        return this.isPointInsideSelectionBox(point, element);
      case 'group':
        return false;
    }
  }

  private isPointInsideSelectionBox(point: Point, element: DesignElement): boolean {
    const box = this.selectionBox(element);
    const radians = (-box.rotation * Math.PI) / 180;
    const dx = point.x - box.x;
    const dy = point.y - box.y;
    const local = {
      x: dx * Math.cos(radians) - dy * Math.sin(radians),
      y: dx * Math.sin(radians) + dy * Math.cos(radians),
    };
    return local.x >= 0 && local.y >= 0 && local.x <= box.width && local.y <= box.height;
  }

  private isPointInsideTriangle(point: Point, width: number, height: number): boolean {
    const a = { x: width / 2, y: 0 };
    const b = { x: width, y: height };
    const c = { x: 0, y: height };
    const area = this.triangleSignedArea(a, b, c);
    if (area === 0) {
      return false;
    }

    const s = this.triangleSignedArea(point, b, c) / area;
    const t = this.triangleSignedArea(a, point, c) / area;
    const u = this.triangleSignedArea(a, b, point) / area;
    return s >= 0 && t >= 0 && u >= 0;
  }

  private triangleSignedArea(a: Point, b: Point, c: Point): number {
    return ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }

  private toElementLocalPoint(point: Point, element: DesignElement): Point {
    if (element.type === 'rectangle') {
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
