import { beforeEach, describe, expect, it } from 'vitest';
import { AppSettingsService } from './app-settings.service';

describe('AppSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the light theme', () => {
    const settings = new AppSettingsService();

    expect(settings.theme()).toBe('light');
  });

  it('persists the selected theme between service instances', () => {
    const settings = new AppSettingsService();

    settings.updateTheme('dark');

    expect(new AppSettingsService().theme()).toBe('dark');
  });

  it('falls back to light for invalid stored themes', () => {
    localStorage.setItem('character-card-builder:app-settings', JSON.stringify({ theme: 'blue' }));

    const settings = new AppSettingsService();

    expect(settings.theme()).toBe('light');
  });
});
