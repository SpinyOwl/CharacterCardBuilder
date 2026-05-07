import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OverlayModule } from '@angular/cdk/overlay';
import { MenuBar, MenuItem } from '@angular/aria/menu';
import { Toolbar, ToolbarWidget, ToolbarWidgetGroup } from '@angular/aria/toolbar';
import { Tree, TreeItem } from '@angular/aria/tree';
import {
  DesignElement,
  GearElement,
  RectangleElement,
  isGearElement,
  isRectangleElement,
} from './models/element.model';
import { Layer } from './models/layer.model';
import { ExportService } from './services/export.service';
import { ImportExportService } from './services/import-export.service';
import { ProjectStateService } from './services/project-state.service';
import { PageOrientation, PageSetup, PaperSize } from './models/project.model';
import { createPolygonPath, createTrianglePath, roundedRectPath } from './utils/geometry.utils';
import { createGearPath } from './utils/gear.utils';

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

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const PAPER_SIZES: Record<PaperSize, { width: number; height: number }> = {
  A6: { width: 105, height: 148 },
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  Letter: { width: 216, height: 279 },
};

const DEFAULT_PAGE_SETUP: PageSetup = {
  paperSize: 'A5',
  orientation: 'landscape',
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  showPageBorder: true,
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OverlayModule,
    MenuBar,
    MenuItem,
    Toolbar,
    ToolbarWidget,
    ToolbarWidgetGroup,
    Tree,
    TreeItem,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  @ViewChild('scene', { static: false }) private readonly scene?: ElementRef<SVGSVGElement>;

  readonly state = inject(ProjectStateService);
  private readonly importExport = inject(ImportExportService);
  private readonly exportService = inject(ExportService);

  readonly yamlText = signal('');
  readonly importError = signal<string | null>(null);
  readonly isFileMenuOpen = signal(false);
  readonly isImportExportOpen = signal(false);
  readonly isPageSetupOpen = signal(false);
  readonly pageSetupDraft = signal<PageSetup>(this.currentPageSetup());
  readonly paperSizes: PaperSize[] = ['A6', 'A5', 'A4', 'A3', 'Letter'];
  readonly resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  readonly selectedLayerValues = computed(() => {
    const selectedLayerId = this.state.selectedLayerId();
    return selectedLayerId ? [selectedLayerId] : [];
  });
  readonly visibleDesignBounds = computed(() => this.measureVisibleDesignBounds());
  readonly approxPaperLabel = computed(() => {
    const bounds = this.visibleDesignBounds();
    if (!bounds) {
      return 'No visible design bounds';
    }

    const option = this.paperSizes
      .flatMap((paperSize) => [
        {
          paperSize,
          orientation: 'portrait' as const,
          ...this.pageDimensions(paperSize, 'portrait'),
        },
        {
          paperSize,
          orientation: 'landscape' as const,
          ...this.pageDimensions(paperSize, 'landscape'),
        },
      ])
      .sort((a, b) => a.width * a.height - b.width * b.height)
      .find((candidate) => bounds.width <= candidate.width && bounds.height <= candidate.height);

    return option
      ? `${option.paperSize} ${option.orientation} or larger (${this.formatMm(bounds.width)} x ${this.formatMm(bounds.height)} mm)`
      : `Larger than listed paper (${this.formatMm(bounds.width)} x ${this.formatMm(bounds.height)} mm)`;
  });
  readonly math = Math;

  private dragState: DragState | null = null;

  constructor() {
    this.refreshYaml();
  }

  setMode(mode: 'edit' | 'view'): void {
    this.state.setMode(mode);
  }

  toggleFileMenu(): void {
    this.isFileMenuOpen.update((open) => !open);
  }

  closeFileMenu(): void {
    this.isFileMenuOpen.set(false);
  }

  openProject(projectInput: HTMLInputElement): void {
    this.closeFileMenu();
    projectInput.click();
  }

  async onProjectFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      this.state.setProject(this.importExport.importYaml(await file.text()));
      this.importError.set(null);
      this.refreshYaml();
    } catch (error) {
      this.importError.set(error instanceof Error ? error.message : 'Unable to open project.');
    } finally {
      input.value = '';
    }
  }

  saveProject(): void {
    this.closeFileMenu();
    this.downloadYaml();
  }

  showImportExport(): void {
    this.closeFileMenu();
    this.refreshYaml();
    this.isImportExportOpen.set(true);
  }

  closeImportExport(): void {
    this.isImportExportOpen.set(false);
  }

  openPageSetup(): void {
    this.pageSetupDraft.set(this.currentPageSetup());
    this.isPageSetupOpen.set(true);
    this.closeFileMenu();
  }

  closePageSetup(): void {
    this.isPageSetupOpen.set(false);
  }

  updatePageSetupDraft<K extends keyof PageSetup>(property: K, value: PageSetup[K]): void {
    this.pageSetupDraft.update((draft) => ({ ...draft, [property]: value }));
  }

  updatePageSetupNumber(
    property: keyof Pick<PageSetup, 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight'>,
    value: string | number,
  ): void {
    const numberValue = typeof value === 'number' ? value : Number(value);
    this.updatePageSetupDraft(
      property,
      Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0,
    );
  }

  applyPageSetup(): void {
    const pageSetup = this.pageSetupDraft();
    const dimensions = this.pageDimensions(pageSetup.paperSize, pageSetup.orientation);
    this.state.updatePageSetup(pageSetup);
    this.state.updateCanvas({
      width: dimensions.width,
      height: dimensions.height,
      backgroundColor: this.state.project().canvas.backgroundColor ?? '#ffffff',
    });
    this.refreshYaml();
    this.closePageSetup();
  }

  refreshYaml(): void {
    this.yamlText.set(this.importExport.exportYaml(this.state.project()));
  }

  importYaml(): void {
    try {
      this.state.setProject(this.importExport.importYaml(this.yamlText()));
      this.importError.set(null);
      this.refreshYaml();
    } catch (error) {
      this.importError.set(error instanceof Error ? error.message : 'Unable to import project.');
    }
  }

  exportSvg(): void {
    const svg = this.scene?.nativeElement;
    if (!svg) {
      return;
    }
    this.exportService.downloadText(
      'layered-card.svg',
      this.exportService.serializeSvg(svg),
      'image/svg+xml',
    );
  }

  downloadYaml(): void {
    this.refreshYaml();
    this.exportService.downloadText('layered-card.yaml', this.yamlText(), 'text/yaml');
  }

  updatePageColor(value: string): void {
    this.state.updateCanvas({ backgroundColor: value });
    this.refreshYaml();
  }

  pageDimensions(
    paperSize: PaperSize,
    orientation: PageOrientation,
  ): { width: number; height: number } {
    const size = PAPER_SIZES[paperSize];
    return orientation === 'portrait'
      ? { width: size.width, height: size.height }
      : { width: size.height, height: size.width };
  }

  formatMm(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  onLayerSelectionChange(values: string[]): void {
    this.state.selectLayer(values[0] ?? null);
  }

  toggleLayerVisible(layer: Layer, visible: boolean): void {
    this.state.updateLayer(layer.id, { visible });
    if (!visible && this.state.selectedLayerId() === layer.id) {
      this.state.selectElement(null);
    }
    this.refreshYaml();
  }

  toggleLayerLocked(layer: Layer, locked: boolean): void {
    this.state.updateLayer(layer.id, { locked });
    if (locked && this.state.selectedLayerId() === layer.id) {
      this.state.selectElement(null);
    }
    this.refreshYaml();
  }

  updateSelectedString(
    property: 'name' | 'fill' | 'stroke' | 'text' | 'fontFamily',
    value: string,
  ): void {
    this.patchSelected({ [property]: value } as Partial<DesignElement>);
  }

  updateSelectedNumber(property: string, rawValue: string | number): void {
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (Number.isFinite(value)) {
      this.patchSelected({ [property]: value } as Partial<DesignElement>);
    }
  }

  updateSelectedMode(mode: 'additive' | 'subtractive'): void {
    this.patchSelected({ mode } as Partial<DesignElement>);
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
    this.refreshYaml();
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
      this.refreshYaml();
      return;
    }

    if (this.dragState.kind === 'resize-rectangle') {
      this.resizeRectangleFromPointer(event, this.dragState);
      this.refreshYaml();
      return;
    }

    const found = this.state.findElement(this.dragState.elementId);
    if (!found || !isGearElement(found.element)) {
      return;
    }

    const angle = this.pointerAngle(event, found.element);
    this.state.rotateGearInViewMode(this.dragState.elementId, angle - this.dragState.lastAngle);
    this.dragState = { ...this.dragState, lastAngle: angle };
    this.refreshYaml();
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
        return '';
    }
  }

  rectangleTransform(element: RectangleElement): string {
    return `translate(${element.x + element.width / 2} ${element.y + element.height / 2}) rotate(${element.rotation}) translate(${-element.width / 2} ${-element.height / 2})`;
  }

  isAdditiveVisible(element: DesignElement): boolean {
    return element.visible && element.mode === 'additive';
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

  isRectangle(element: DesignElement): element is RectangleElement {
    return isRectangleElement(element);
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

  private patchSelected(patch: Partial<DesignElement>): void {
    const selectedElementId = this.state.selectedElementId();
    if (selectedElementId) {
      this.state.updateElement(selectedElementId, patch);
      this.refreshYaml();
    }
  }

  private currentPageSetup(): PageSetup {
    return this.state.project().pageSetup ?? DEFAULT_PAGE_SETUP;
  }

  private measureVisibleDesignBounds(): { width: number; height: number } | null {
    const bounds = this.state
      .visibleLayers()
      .flatMap((layer) => layer.elements.filter((element) => element.visible))
      .map((element) => this.elementBounds(element));

    if (bounds.length === 0) {
      return null;
    }

    const minX = Math.min(...bounds.map((bound) => bound.minX));
    const minY = Math.min(...bounds.map((bound) => bound.minY));
    const maxX = Math.max(...bounds.map((bound) => bound.maxX));
    const maxY = Math.max(...bounds.map((bound) => bound.maxY));
    return { width: maxX - minX, height: maxY - minY };
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

  private elementBounds(element: DesignElement): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    switch (element.type) {
      case 'rectangle':
      case 'triangle':
        return {
          minX: element.x,
          minY: element.y,
          maxX: element.x + element.width,
          maxY: element.y + element.height,
        };
      case 'circle':
        return {
          minX: element.x - element.radius,
          minY: element.y - element.radius,
          maxX: element.x + element.radius,
          maxY: element.y + element.radius,
        };
      case 'polygon': {
        const points = element.points.length > 0 ? element.points : [{ x: 0, y: 0 }];
        return {
          minX: element.x + Math.min(...points.map((point) => point.x)),
          minY: element.y + Math.min(...points.map((point) => point.y)),
          maxX: element.x + Math.max(...points.map((point) => point.x)),
          maxY: element.y + Math.max(...points.map((point) => point.y)),
        };
      }
      case 'gear': {
        const radius = element.discRadius + element.toothHeight;
        return {
          minX: element.x - radius,
          minY: element.y - radius,
          maxX: element.x + radius,
          maxY: element.y + radius,
        };
      }
      case 'text':
        return {
          minX: element.x,
          minY: element.y - element.fontSize,
          maxX: element.x + element.text.length * element.fontSize * 0.55,
          maxY: element.y,
        };
    }
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
