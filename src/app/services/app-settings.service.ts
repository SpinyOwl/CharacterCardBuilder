import { Injectable, computed, signal } from '@angular/core';

export type ApplicationTheme = 'light' | 'dark';

export interface AppSettings {
  theme: ApplicationTheme;
}

const SETTINGS_STORAGE_KEY = 'character-card-builder:app-settings';
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
};

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly settingsState = signal<AppSettings>(this.loadSettings());

  readonly settings = this.settingsState.asReadonly();
  readonly theme = computed(() => this.settingsState().theme);

  updateTheme(theme: ApplicationTheme): void {
    this.updateSettings({ theme });
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
}
