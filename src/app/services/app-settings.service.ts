import { Injectable, computed, signal } from '@angular/core';

export type ApplicationTheme = 'light' | 'dark';

export interface AppSettings {
  theme: ApplicationTheme;
  selectionOutlineColor: string;
  selectionOutlineThickness: number;
  selectionHandleSize: number;
}

const SETTINGS_STORAGE_KEY = 'character-card-builder:app-settings';
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  selectionOutlineColor: '#d21f3c',
  selectionOutlineThickness: 0.8,
  selectionHandleSize: 2.8,
};
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

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
}
