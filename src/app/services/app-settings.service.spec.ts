import { beforeEach, describe, expect, it } from 'vitest';
import { AppSettingsService } from './app-settings.service';

describe('AppSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the light theme', () => {
    const settings = new AppSettingsService();

    expect(settings.theme()).toBe('light');
    expect(settings.selectionOutlineColor()).toBe('#d21f3c');
    expect(settings.selectionOutlineThickness()).toBe(0.8);
    expect(settings.selectionHandleSize()).toBe(2.8);
    expect(settings.gridEnabled()).toBe(false);
    expect(settings.gridSize()).toBe(5);
    expect(settings.canvasViewMode()).toBe('fit');
    expect(settings.canvasScale()).toBe(1);
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

  it('persists selection appearance settings between service instances', () => {
    const settings = new AppSettingsService();

    settings.updateSelectionOutlineColor('#00ff88');
    settings.updateSelectionOutlineThickness(1.4);
    settings.updateSelectionHandleSize(4);

    const reloadedSettings = new AppSettingsService();
    expect(reloadedSettings.selectionOutlineColor()).toBe('#00ff88');
    expect(reloadedSettings.selectionOutlineThickness()).toBe(1.4);
    expect(reloadedSettings.selectionHandleSize()).toBe(4);
  });

  it('falls back to defaults for invalid selection appearance settings', () => {
    localStorage.setItem(
      'character-card-builder:app-settings',
      JSON.stringify({
        selectionOutlineColor: 'red',
        selectionOutlineThickness: -1,
        selectionHandleSize: Number.NaN,
      }),
    );

    const settings = new AppSettingsService();

    expect(settings.selectionOutlineColor()).toBe('#d21f3c');
    expect(settings.selectionOutlineThickness()).toBe(0.8);
    expect(settings.selectionHandleSize()).toBe(2.8);
  });

  it('persists grid settings between service instances', () => {
    const settings = new AppSettingsService();

    settings.updateGridEnabled(true);
    settings.updateGridSize(2.5);

    const reloadedSettings = new AppSettingsService();
    expect(reloadedSettings.gridEnabled()).toBe(true);
    expect(reloadedSettings.gridSize()).toBe(2.5);
  });

  it('falls back to defaults for invalid grid settings', () => {
    localStorage.setItem(
      'character-card-builder:app-settings',
      JSON.stringify({
        gridEnabled: 'yes',
        gridSize: 0,
      }),
    );

    const settings = new AppSettingsService();

    expect(settings.gridEnabled()).toBe(false);
    expect(settings.gridSize()).toBe(5);
  });

  it('persists canvas view settings between service instances', () => {
    const settings = new AppSettingsService();

    settings.updateCanvasScale(1.75);
    settings.updateCanvasViewMode('fit');

    let reloadedSettings = new AppSettingsService();
    expect(reloadedSettings.canvasViewMode()).toBe('fit');
    expect(reloadedSettings.canvasScale()).toBe(1.75);

    reloadedSettings.updateCanvasScale(0.5);
    reloadedSettings = new AppSettingsService();
    expect(reloadedSettings.canvasViewMode()).toBe('scaled');
    expect(reloadedSettings.canvasScale()).toBe(0.5);
  });

  it('falls back to defaults or clamps invalid canvas view settings', () => {
    localStorage.setItem(
      'character-card-builder:app-settings',
      JSON.stringify({
        canvasViewMode: 'full',
        canvasScale: 12,
      }),
    );

    let settings = new AppSettingsService();
    expect(settings.canvasViewMode()).toBe('fit');
    expect(settings.canvasScale()).toBe(4);

    localStorage.setItem(
      'character-card-builder:app-settings',
      JSON.stringify({
        canvasViewMode: 'scaled',
        canvasScale: 0.1,
      }),
    );

    settings = new AppSettingsService();
    expect(settings.canvasViewMode()).toBe('scaled');
    expect(settings.canvasScale()).toBe(0.25);
  });
});
