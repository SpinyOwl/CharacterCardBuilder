import { Injectable, computed, signal } from '@angular/core';

export type ApplicationTheme = 'light' | 'dark';
export type CanvasViewMode = 'fit' | 'scaled';

export interface AppSettings {
  theme: ApplicationTheme;
  selectionOutlineColor: string;
  selectionOutlineThickness: number;
  selectionHandleSize: number;
  gridEnabled: boolean;
  gridSize: number;
  canvasViewMode: CanvasViewMode;
  canvasScale: number;
}

const SETTINGS_STORAGE_KEY = 'character-card-builder:app-settings';
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  selectionOutlineColor: '#d21f3c',
  selectionOutlineThickness: 0.8,
  selectionHandleSize: 2.8,
  gridEnabled: false,
  gridSize: 5,
  canvasViewMode: 'fit',
  canvasScale: 1,
};
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 4;

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly settingsState = signal<AppSettings>(this.loadSettings());

  readonly settings = this.settingsState.asReadonly();
  readonly theme = computed(() => this.settingsState().theme);
  readonly selectionOutlineColor = computed(() => this.settingsState().selectionOutlineColor);
  readonly selectionOutlineThickness = computed(
    () => this.settingsState().selectionOutlineThickness,
  );
  readonly selectionHandleSize = computed(() => this.settingsState().selectionHandleSize);
  readonly gridEnabled = computed(() => this.settingsState().gridEnabled);
  readonly gridSize = computed(() => this.settingsState().gridSize);
  readonly canvasViewMode = computed(() => this.settingsState().canvasViewMode);
  readonly canvasScale = computed(() => this.settingsState().canvasScale);

  updateTheme(theme: ApplicationTheme): void {
    this.updateSettings({ theme });
  }

  updateSelectionOutlineColor(selectionOutlineColor: string): void {
    this.updateSettings({ selectionOutlineColor: this.normalizeColor(selectionOutlineColor) });
  }

  updateSelectionOutlineThickness(selectionOutlineThickness: number): void {
    this.updateSettings({
      selectionOutlineThickness: this.normalizePositiveNumber(
        selectionOutlineThickness,
        DEFAULT_SETTINGS.selectionOutlineThickness,
      ),
    });
  }

  updateSelectionHandleSize(selectionHandleSize: number): void {
    this.updateSettings({
      selectionHandleSize: this.normalizePositiveNumber(
        selectionHandleSize,
        DEFAULT_SETTINGS.selectionHandleSize,
      ),
    });
  }

  updateGridEnabled(gridEnabled: boolean): void {
    this.updateSettings({ gridEnabled });
  }

  updateGridSize(gridSize: number): void {
    this.updateSettings({
      gridSize: this.normalizePositiveNumber(gridSize, DEFAULT_SETTINGS.gridSize),
    });
  }

  updateCanvasViewMode(canvasViewMode: CanvasViewMode): void {
    this.updateSettings({ canvasViewMode });
  }

  updateCanvasScale(canvasScale: number): void {
    this.updateSettings({
      canvasViewMode: 'scaled',
      canvasScale: this.normalizeCanvasScale(canvasScale),
    });
  }

  private updateSettings(patch: Partial<AppSettings>): void {
    this.settingsState.update((settings) => {
      const nextSettings = { ...settings, ...patch };
      this.saveSettings(nextSettings);
      return nextSettings;
    });
  }

  private loadSettings(): AppSettings {
    try {
      const rawSettings = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
      if (!rawSettings) {
        return DEFAULT_SETTINGS;
      }

      const settings = JSON.parse(rawSettings) as Partial<AppSettings>;
      return {
        ...DEFAULT_SETTINGS,
        theme: settings.theme === 'dark' ? 'dark' : 'light',
        selectionOutlineColor: this.normalizeColor(settings.selectionOutlineColor),
        selectionOutlineThickness: this.normalizePositiveNumber(
          settings.selectionOutlineThickness,
          DEFAULT_SETTINGS.selectionOutlineThickness,
        ),
        selectionHandleSize: this.normalizePositiveNumber(
          settings.selectionHandleSize,
          DEFAULT_SETTINGS.selectionHandleSize,
        ),
        gridEnabled: settings.gridEnabled === true,
        gridSize: this.normalizePositiveNumber(settings.gridSize, DEFAULT_SETTINGS.gridSize),
        canvasViewMode: settings.canvasViewMode === 'scaled' ? 'scaled' : 'fit',
        canvasScale: this.normalizeCanvasScale(settings.canvasScale),
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private saveSettings(settings: AppSettings): void {
    try {
      globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }

  private normalizeColor(value: unknown): string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
      ? value
      : DEFAULT_SETTINGS.selectionOutlineColor;
  }

  private normalizePositiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private normalizeCanvasScale(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_SETTINGS.canvasScale;
    }
    return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
  }
}
