import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MenuBar, MenuItem } from '@angular/aria/menu';
import { Toolbar, ToolbarWidget, ToolbarWidgetGroup } from '@angular/aria/toolbar';
import { Tree, TreeItem, TreeItemGroup } from '@angular/aria/tree';
import { CanvasStageComponent } from './canvas-stage/canvas-stage.component';
import { DesignElement } from './models/element.model';
import { Layer } from './models/layer.model';
import { ExportService } from './services/export.service';
import { ImportExportService } from './services/import-export.service';
import { ProjectStateService } from './services/project-state.service';
import { PageOrientation, PageSetup, PaperSize } from './models/project.model';

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
    }
  | {
      kind: 'element';
      name: string;
      value: string;
      element: DesignElement;
      expanded?: boolean;
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
  private readonly importExport = inject(ImportExportService);
  private readonly exportService = inject(ExportService);

  readonly yamlText = signal('');
  readonly importError = signal<string | null>(null);
  readonly isFileMenuOpen = signal(false);
  readonly isImportExportOpen = signal(false);
  readonly isPageSetupOpen = signal(false);
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
    this.state.project().layers.map((layer) => ({
      kind: 'layer',
      name: layer.name,
      value: this.layerTreeValue(layer.id),
      layer,
      expanded: true,
      children: layer.elements.map((element) => ({
        kind: 'element',
        name: element.name,
        value: this.elementTreeValue(element.id),
        element,
      })),
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

  deleteElement(element: DesignElement): void {
    this.state.deleteElement(element.id);
    this.refreshYaml();
  }

  layerTreeValue(layerId: string): string {
    return `layer:${layerId}`;
  }

  elementTreeValue(elementId: string): string {
    return `element:${elementId}`;
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
}
