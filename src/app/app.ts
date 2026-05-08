import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MenuBar, MenuItem } from '@angular/aria/menu';
import { Toolbar, ToolbarWidget, ToolbarWidgetGroup } from '@angular/aria/toolbar';
import { Tree, TreeItem, TreeItemGroup } from '@angular/aria/tree';
import { CanvasStageComponent } from './canvas-stage/canvas-stage.component';
import {
  DesignElement,
  DesignElementType,
  GearElement,
  GearLabel,
  ShapeInteraction,
  ShapeElement,
  isGroupElement,
  isGearElement,
  isShapeElement,
} from './models/element.model';
import { Layer } from './models/layer.model';
import { ExportService } from './services/export.service';
import { ImportExportService } from './services/import-export.service';
import { ProjectStateService } from './services/project-state.service';
import { PageOrientation, PageSetup, PaperSize } from './models/project.model';
import { AppSettingsService, ApplicationTheme } from './services/app-settings.service';
import { ElementContainer } from './services/project-state.service';

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

type ProjectTreeNode =
  | {
      kind: 'layer';
      name: string;
      value: string;
      layer: Layer;
      children: ProjectTreeNode[];
      expanded: boolean;
      index: number;
    }
  | {
      kind: 'element';
      name: string;
      value: string;
      element: DesignElement;
      expanded?: boolean;
      children: ProjectTreeNode[];
      container: ElementContainer;
      index: number;
    }
  | {
      kind: 'interaction';
      name: string;
      value: string;
      owner: ShapeElement;
      interaction: ShapeInteraction;
      children: ProjectTreeNode[];
    };

type ProjectTreeDropPosition = 'above' | 'inside' | 'below';

type ProjectTreeDragData =
  | {
      kind: 'layer';
      value: string;
      layerId: string;
      index: number;
    }
  | {
      kind: 'element';
      value: string;
      elementId: string;
      container: ElementContainer;
      index: number;
    };

type ProjectTreeDropTarget = {
  value: string;
  position: ProjectTreeDropPosition;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MenuBar,
    MenuItem,
    Toolbar,
    ToolbarWidget,
    ToolbarWidgetGroup,
    Tree,
    TreeItem,
    TreeItemGroup,
    CanvasStageComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  @ViewChild(CanvasStageComponent, { static: false })
  private readonly canvasStage?: CanvasStageComponent;

  readonly state = inject(ProjectStateService);
  readonly appSettings = inject(AppSettingsService);
  private readonly importExport = inject(ImportExportService);
  private readonly exportService = inject(ExportService);

  readonly yamlText = signal('');
  readonly importError = signal<string | null>(null);
  readonly isFileMenuOpen = signal(false);
  readonly isImportExportOpen = signal(false);
  readonly isPageSetupOpen = signal(false);
  readonly isSettingsOpen = signal(false);
  readonly isStickyEnabled = signal(false);
  readonly selectedGearLabelId = signal<string | null>(null);
  readonly projectTreeDropTarget = signal<ProjectTreeDropTarget | null>(null);
  readonly projectTreePanelDropTarget = signal<ProjectTreeDropPosition | null>(null);
  readonly isProjectTreeLayerDragActive = signal(false);
  private projectTreeDragData: ProjectTreeDragData | null = null;
  readonly pageSetupDraft = signal<PageSetup>(this.currentPageSetup());
  readonly paperSizes: PaperSize[] = ['A6', 'A5', 'A4', 'A3', 'Letter'];
  readonly selectedProjectTreeValues = computed(() => {
    const selectedElementId = this.state.selectedElementId();
    if (selectedElementId) {
      return [this.elementTreeValue(selectedElementId)];
    }

    const selectedLayerId = this.state.selectedLayerId();
    return selectedLayerId ? [this.layerTreeValue(selectedLayerId)] : [];
  });
  readonly projectTreeNodes = computed<ProjectTreeNode[]>(() =>
    this.visualStack(this.state.project().layers).map(({ item: layer, index }) => ({
      kind: 'layer',
      name: layer.name,
      value: this.layerTreeValue(layer.id),
      layer,
      index,
      expanded: true,
      children: this.elementTreeNodes(layer.elements, { kind: 'layer', layerId: layer.id }),
    })),
  );
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

  constructor() {
    this.refreshYaml();
  }

  setMode(mode: 'edit' | 'view'): void {
    this.state.setMode(mode);
  }

  toggleSticky(): void {
    this.isStickyEnabled.update((enabled) => !enabled);
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

  openSettings(): void {
    this.isSettingsOpen.set(true);
    this.closeFileMenu();
  }

  closeSettings(): void {
    this.isSettingsOpen.set(false);
  }

  updateApplicationTheme(theme: ApplicationTheme): void {
    this.appSettings.updateTheme(theme);
  }

  updateSelectionOutlineColor(color: string): void {
    this.appSettings.updateSelectionOutlineColor(color);
  }

  updateSelectionOutlineNumber(
    setting: 'selectionOutlineThickness' | 'selectionHandleSize',
    rawValue: string | number,
  ): void {
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }

    if (setting === 'selectionOutlineThickness') {
      this.appSettings.updateSelectionOutlineThickness(value);
      return;
    }

    this.appSettings.updateSelectionHandleSize(value);
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
    const svg = this.canvasStage?.getSvgElement();
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

  onProjectTreeSelectionChange(values: string[]): void {
    const value = values[0] ?? null;
    if (!value) {
      this.state.selectLayer(null);
      this.state.selectElement(null);
      return;
    }

    if (value.startsWith('layer:')) {
      this.state.selectLayer(value.slice('layer:'.length));
      this.state.selectElement(null);
      return;
    }

    if (value.startsWith('element:')) {
      this.state.selectElement(value.slice('element:'.length));
      return;
    }

    if (value.startsWith('interaction:')) {
      const [, elementId] = value.split(':');
      this.state.selectElement(elementId);
    }
  }

  toggleLayerVisible(layer: Layer, visible: boolean): void {
    this.state.updateLayer(layer.id, { visible });
    if (!visible && this.state.selectedLayerId() === layer.id) {
      this.state.selectElement(null);
    }
    this.refreshYaml();
  }

  toggleElementVisible(element: DesignElement, visible: boolean): void {
    this.state.updateElement(element.id, { visible } as Partial<DesignElement>);
    if (!visible && this.state.selectedElementId() === element.id) {
      this.state.selectElement(null);
    }
    this.refreshYaml();
  }

  toggleElementLocked(element: DesignElement, locked: boolean): void {
    this.state.updateElement(element.id, { locked } as Partial<DesignElement>);
    if (locked && this.state.selectedElementId() === element.id) {
      this.state.selectElement(null);
    }
    this.refreshYaml();
  }

  deleteElement(element: DesignElement): void {
    this.state.deleteElement(element.id);
    this.refreshYaml();
  }

  isProjectTreeNodeDraggable(node: ProjectTreeNode): boolean {
    if (node.kind === 'interaction') {
      return false;
    }
    return node.kind === 'layer' || !node.element.locked;
  }

  onProjectTreeDragStart(event: DragEvent, node: ProjectTreeNode): void {
    if (!this.isProjectTreeNodeDraggable(node)) {
      event.preventDefault();
      return;
    }

    if (node.kind === 'layer') {
      this.projectTreeDragData = {
        kind: 'layer',
        value: node.value,
        layerId: node.layer.id,
        index: node.index,
      };
      this.isProjectTreeLayerDragActive.set(true);
    } else if (node.kind === 'element') {
      this.projectTreeDragData = {
        kind: 'element',
        value: node.value,
        elementId: node.element.id,
        container: node.container,
        index: node.index,
      };
    }
    event.dataTransfer?.setData('text/plain', node.value);
    event.dataTransfer?.setDragImage(event.currentTarget as Element, 12, 12);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onProjectTreeDragOver(event: DragEvent, node: ProjectTreeNode): void {
    if (!this.projectTreeDragData || !this.canDropProjectTreeNode(this.projectTreeDragData, node)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.projectTreePanelDropTarget.set(null);
    this.projectTreeDropTarget.set({
      value: node.value,
      position: this.projectTreeDropPosition(event, node),
    });
  }

  onProjectTreeDrop(event: DragEvent, node: ProjectTreeNode): void {
    const dragData = this.projectTreeDragData;
    if (!dragData || !this.canDropProjectTreeNode(dragData, node)) {
      this.clearProjectTreeDrag();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const position = this.projectTreeDropPosition(event, node);
    if (dragData.kind === 'layer' && node.kind === 'layer') {
      const targetIndex = this.visualDropIndex(node.index, position);
      this.state.reorderLayer(
        dragData.index,
        this.adjustSameContainerIndex(dragData.index, targetIndex),
      );
    }

    if (dragData.kind === 'element' && node.kind !== 'interaction') {
      const target = this.projectTreeElementDropTarget(node, position);
      const targetIndex = containersEqual(dragData.container, target.container)
        ? this.adjustSameContainerIndex(dragData.index, target.index)
        : target.index;
      this.state.moveElementToContainer(dragData.elementId, target.container, targetIndex);
    }

    this.refreshYaml();
    this.clearProjectTreeDrag();
  }

  onProjectPanelDragOver(event: DragEvent): void {
    if (
      this.projectTreeDragData?.kind !== 'layer' ||
      (event.target instanceof HTMLElement && event.target.closest('.tree-row'))
    ) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.projectTreeDropTarget.set(null);
    this.projectTreePanelDropTarget.set(this.projectPanelDropPosition(event));
  }

  onProjectPanelDrop(event: DragEvent): void {
    const dragData = this.projectTreeDragData;
    if (
      dragData?.kind !== 'layer' ||
      (event.target instanceof HTMLElement && event.target.closest('.tree-row'))
    ) {
      return;
    }

    event.preventDefault();
    const targetIndex =
      this.projectPanelDropPosition(event) === 'above' ? this.state.project().layers.length : 0;
    this.state.reorderLayer(
      dragData.index,
      this.adjustSameContainerIndex(dragData.index, targetIndex),
    );
    this.refreshYaml();
    this.clearProjectTreeDrag();
  }

  onProjectTreeDragEnd(): void {
    this.clearProjectTreeDrag();
  }

  isProjectTreeDropTarget(node: ProjectTreeNode, position: ProjectTreeDropPosition): boolean {
    const target = this.projectTreeDropTarget();
    return target?.value === node.value && target.position === position;
  }

  isProjectTreePanelDropTarget(position: ProjectTreeDropPosition): boolean {
    return this.projectTreePanelDropTarget() === position;
  }

  isProjectTreeNodeExpanded(node: ProjectTreeNode): boolean {
    if (node.kind === 'interaction') {
      return false;
    }
    return node.kind === 'layer' && this.isProjectTreeLayerDragActive()
      ? false
      : Boolean(node.expanded);
  }

  toggleProjectTreeNodeExpanded(node: ProjectTreeNode): void {
    if (node.kind === 'interaction' || node.children.length === 0) {
      return;
    }
    node.expanded = !this.isProjectTreeNodeExpanded(node);
  }

  addRotationInteraction(element: ShapeElement): void {
    const interaction: ShapeInteraction = {
      id: `rotation-${crypto.randomUUID().slice(0, 8)}`,
      type: 'rotation',
      name: 'Rotation point',
      visible: true,
      pivotX: 0,
      pivotY: 0,
    };
    this.state.updateElement(element.id, {
      interactions: [...(element.interactions ?? []), interaction],
    } as Partial<DesignElement>);
    this.refreshYaml();
  }

  addSlideInteraction(element: ShapeElement): void {
    const interaction: ShapeInteraction = {
      id: `slide-${crypto.randomUUID().slice(0, 8)}`,
      type: 'slide',
      name: 'Slide axis',
      visible: true,
      startX: -20,
      startY: 0,
      endX: 20,
      endY: 0,
    };
    this.state.updateElement(element.id, {
      interactions: [...(element.interactions ?? []), interaction],
    } as Partial<DesignElement>);
    this.refreshYaml();
  }

  updateInteractionVisible(
    element: ShapeElement,
    interaction: ShapeInteraction,
    visible: boolean,
  ): void {
    this.patchInteraction(element, interaction.id, { visible });
  }

  deleteInteraction(element: ShapeElement, interaction: ShapeInteraction): void {
    this.state.updateElement(element.id, {
      interactions: (element.interactions ?? []).filter((candidate) => candidate.id !== interaction.id),
    } as Partial<DesignElement>);
    this.refreshYaml();
  }

  layerTreeValue(layerId: string): string {
    return `layer:${layerId}`;
  }

  elementTreeValue(elementId: string): string {
    return `element:${elementId}`;
  }

  interactionTreeValue(elementId: string, interactionId: string): string {
    return `interaction:${elementId}:${interactionId}`;
  }

  elementTypeIcon(type: DesignElementType): string {
    switch (type) {
      case 'gear':
        return 'settings';
      case 'rectangle':
        return 'rectangle';
      case 'circle':
        return 'circle';
      case 'triangle':
        return 'change_history';
      case 'polygon':
        return 'pentagon';
      case 'text':
        return 'text_fields';
      case 'group':
        return 'folder';
    }
  }

  interactionTypeIcon(type: ShapeInteraction['type']): string {
    return type === 'rotation' ? 'sync' : 'linear_scale';
  }

  addLayer(): void {
    this.state.addLayer();
    this.refreshYaml();
  }

  addElement(type: Exclude<DesignElementType, 'polygon'>): void {
    this.state.addElementToSelectedLayer(type);
    this.refreshYaml();
  }

  private elementTreeNode(
    element: DesignElement,
    container: ElementContainer,
    index: number,
  ): ProjectTreeNode {
    const interactionNodes = isShapeElement(element)
      ? (element.interactions ?? []).map((interaction) => ({
          kind: 'interaction' as const,
          name: interaction.name,
          value: this.interactionTreeValue(element.id, interaction.id),
          owner: element,
          interaction,
          children: [],
        }))
      : [];

    return {
      kind: 'element',
      name: element.name,
      value: this.elementTreeValue(element.id),
      element,
      container,
      index,
      expanded: true,
      children: isGroupElement(element)
        ? this.elementTreeNodes(element.elements, { kind: 'group', groupId: element.id })
        : interactionNodes,
    };
  }

  private elementTreeNodes(
    elements: DesignElement[],
    container: ElementContainer,
  ): ProjectTreeNode[] {
    return this.visualStack(elements).map(({ item, index }) =>
      this.elementTreeNode(item, container, index),
    );
  }

  private canDropProjectTreeNode(
    dragData: ProjectTreeDragData,
    node: ProjectTreeNode,
  ): boolean {
    if (dragData.value === node.value || node.kind === 'interaction') {
      return false;
    }

    if (dragData.kind === 'layer') {
      return node.kind === 'layer';
    }

    if (node.kind === 'layer') {
      return true;
    }

    if (isGroupElement(node.element)) {
      return dragData.elementId !== node.element.id;
    }

    return true;
  }

  private projectTreeDropPosition(
    event: DragEvent,
    node: ProjectTreeNode,
  ): ProjectTreeDropPosition {
    if (node.kind === 'layer' && this.projectTreeDragData?.kind === 'element') {
      return 'inside';
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = event.clientY - rect.top;
    if (node.kind === 'element' && isGroupElement(node.element)) {
      if (offset < rect.height / 3) {
        return 'above';
      }
      if (offset > (rect.height * 2) / 3) {
        return 'below';
      }
      return 'inside';
    }

    return offset > rect.height / 2 ? 'below' : 'above';
  }

  private projectTreeElementDropTarget(
    node: Exclude<ProjectTreeNode, { kind: 'interaction' }>,
    position: ProjectTreeDropPosition,
  ): { container: ElementContainer; index: number } {
    if (node.kind === 'layer') {
      return { container: { kind: 'layer', layerId: node.layer.id }, index: node.layer.elements.length };
    }

    if (position === 'inside' && isGroupElement(node.element)) {
      return { container: { kind: 'group', groupId: node.element.id }, index: node.element.elements.length };
    }

    return {
      container: node.container,
      index: this.visualDropIndex(node.index, position),
    };
  }

  private visualDropIndex(sourceIndex: number, position: ProjectTreeDropPosition): number {
    return position === 'above' ? sourceIndex + 1 : sourceIndex;
  }

  private adjustSameContainerIndex(sourceIndex: number, targetIndex: number): number {
    return sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  }

  private visualStack<T>(items: T[]): Array<{ item: T; index: number }> {
    return items
      .map((item, index) => ({ item, index }))
      .reverse();
  }

  private projectPanelDropPosition(event: DragEvent): ProjectTreeDropPosition {
    const panel = event.currentTarget as HTMLElement;
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.project-tree > .tree-row'));
    if (rows.length === 0) {
      return 'above';
    }

    const firstRowTop = rows[0].getBoundingClientRect().top;
    const lastRowBottom = rows[rows.length - 1].getBoundingClientRect().bottom;
    const midpoint = firstRowTop + (lastRowBottom - firstRowTop) / 2;
    return event.clientY < midpoint ? 'above' : 'below';
  }

  private clearProjectTreeDrag(): void {
    this.projectTreeDragData = null;
    this.projectTreeDropTarget.set(null);
    this.projectTreePanelDropTarget.set(null);
    this.isProjectTreeLayerDragActive.set(false);
  }

  toggleLayerLocked(layer: Layer, locked: boolean): void {
    this.state.updateLayer(layer.id, { locked });
    if (locked && this.state.selectedLayerId() === layer.id) {
      this.state.selectElement(null);
    }
    this.refreshYaml();
  }

  updateSelectedString(
    property:
      | 'name'
      | 'fill'
      | 'stroke'
      | 'text'
      | 'fontFamily'
      | 'fontWeight'
      | 'backgroundImage'
      | 'centerDotFill'
      | 'centerDotStroke',
    value: string,
  ): void {
    this.patchSelected({ [property]: value } as Partial<DesignElement>);
  }

  updateSelectedOptionalString(property: 'backgroundImage', value: string): void {
    this.patchSelected({ [property]: value.trim() || undefined } as Partial<DesignElement>);
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

  updateSelectedTextAlign(align: 'start' | 'middle' | 'end'): void {
    this.patchSelected({ align } as Partial<DesignElement>);
  }

  selectedGearLabel(gear: GearElement): GearLabel | null {
    const selectedId = this.selectedGearLabelId();
    return gear.labels?.find((label) => label.id === selectedId) ?? gear.labels?.[0] ?? null;
  }

  selectGearLabel(labelId: string): void {
    this.selectedGearLabelId.set(labelId);
  }

  addGearLabel(gear: GearElement): void {
    const nextIndex = (gear.labels?.length ?? 0) + 1;
    const label: GearLabel = {
      id: `gear-label-${crypto.randomUUID().slice(0, 8)}`,
      text: `Label ${nextIndex}`,
      angle: 0,
      offsetFromEdge: Math.round(gear.discRadius * 0.45),
      rotation: 0,
      fontSize: 4,
      fontFamily: 'Arial, sans-serif',
      fontWeight: '400',
      fill: '#392710',
      align: 'middle',
    };

    this.state.updateElement(gear.id, {
      labels: [...(gear.labels ?? []), label],
    } as Partial<GearElement>);
    this.selectedGearLabelId.set(label.id);
    this.refreshYaml();
  }

  deleteGearLabel(gear: GearElement, labelId: string): void {
    const labels = (gear.labels ?? []).filter((label) => label.id !== labelId);
    this.state.updateElement(gear.id, { labels } as Partial<GearElement>);
    this.selectedGearLabelId.set(labels[0]?.id ?? null);
    this.refreshYaml();
  }

  updateGearLabelString(
    gear: GearElement,
    labelId: string,
    property: 'text' | 'fontFamily' | 'fontWeight' | 'fill',
    value: string,
  ): void {
    this.patchGearLabel(gear, labelId, { [property]: value } as Partial<GearLabel>);
  }

  updateGearLabelNumber(
    gear: GearElement,
    labelId: string,
    property: 'angle' | 'offsetFromEdge' | 'rotation' | 'fontSize',
    rawValue: string | number,
  ): void {
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (Number.isFinite(value)) {
      this.patchGearLabel(gear, labelId, { [property]: value } as Partial<GearLabel>);
    }
  }

  updateGearLabelAlign(
    gear: GearElement,
    labelId: string,
    align: 'start' | 'middle' | 'end',
  ): void {
    this.patchGearLabel(gear, labelId, { align });
  }

  updateInteractionString(
    element: ShapeElement,
    interactionId: string,
    property: 'name',
    value: string,
  ): void {
    this.patchInteraction(element, interactionId, { [property]: value } as Partial<ShapeInteraction>);
  }

  updateInteractionNumber(
    element: ShapeElement,
    interactionId: string,
    property: 'pivotX' | 'pivotY' | 'startX' | 'startY' | 'endX' | 'endY',
    rawValue: string | number,
  ): void {
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (Number.isFinite(value)) {
      this.patchInteraction(element, interactionId, { [property]: value } as Partial<ShapeInteraction>);
    }
  }

  isShapeElement(element: DesignElement): element is ShapeElement {
    return isShapeElement(element);
  }

  isGearElement(element: DesignElement): element is GearElement {
    return isGearElement(element);
  }

  private patchSelected(patch: Partial<DesignElement>): void {
    const selectedElementId = this.state.selectedElementId();
    if (selectedElementId) {
      this.state.updateElement(selectedElementId, patch);
      this.refreshYaml();
    }
  }

  private patchGearLabel(
    gear: GearElement,
    labelId: string,
    patch: Partial<GearLabel>,
  ): void {
    const labels = (gear.labels ?? []).map((label) =>
      label.id === labelId ? { ...label, ...patch } : label,
    );
    this.state.updateElement(gear.id, { labels } as Partial<GearElement>);
    this.refreshYaml();
  }

  private patchInteraction(
    element: ShapeElement,
    interactionId: string,
    patch: Partial<ShapeInteraction>,
  ): void {
    this.state.updateElementInteraction(element.id, interactionId, patch);
    this.refreshYaml();
  }

  private currentPageSetup(): PageSetup {
    return this.state.project().pageSetup ?? DEFAULT_PAGE_SETUP;
  }

  private measureVisibleDesignBounds(): { width: number; height: number } | null {
    const bounds = this.state
      .visibleLayers()
      .flatMap((layer) => this.flattenElements(layer.elements).filter((element) => element.visible))
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
      case 'group': {
        const bounds = this.flattenElements(element.elements)
          .filter((child) => child.visible)
          .map((child) => this.elementBounds(child));
        if (bounds.length === 0) {
          return { minX: element.x, minY: element.y, maxX: element.x, maxY: element.y };
        }
        return {
          minX: Math.min(...bounds.map((bound) => bound.minX)),
          minY: Math.min(...bounds.map((bound) => bound.minY)),
          maxX: Math.max(...bounds.map((bound) => bound.maxX)),
          maxY: Math.max(...bounds.map((bound) => bound.maxY)),
        };
      }
    }
  }

  private flattenElements(elements: DesignElement[]): DesignElement[] {
    return elements.flatMap((element) =>
      isGroupElement(element) ? [element, ...this.flattenElements(element.elements)] : [element],
    );
  }
}

function containersEqual(first: ElementContainer, second: ElementContainer): boolean {
  if (first.kind === 'layer' && second.kind === 'layer') {
    return first.layerId === second.layerId;
  }
  if (first.kind === 'group' && second.kind === 'group') {
    return first.groupId === second.groupId;
  }
  return false;
}
