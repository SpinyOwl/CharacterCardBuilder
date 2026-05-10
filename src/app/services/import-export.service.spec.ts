import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../models/default-project';
import { ImportExportService } from './import-export.service';

describe('ImportExportService', () => {
  it('YAML export/import preserves layers and elements', () => {
    const service = new ImportExportService();
    const project = createDefaultProject();
    const imported = service.importYaml(service.exportYaml(project));

    expect(imported.layers).toHaveLength(project.layers.length);
    expect(imported.layers.flatMap((layer) => layer.elements)).toHaveLength(
      project.layers.flatMap((layer) => layer.elements).length,
    );
  });

  it('subtractive rectangle appears in exported project model', () => {
    const service = new ImportExportService();
    const imported = service.importYaml(service.exportYaml(createDefaultProject()));

    expect(
      imported.layers
        .flatMap((layer) => layer.elements)
        .some((element) => element.type === 'rectangle' && element.mode === 'subtractive'),
    ).toBe(true);
  });

  it('preserves shape background images', () => {
    const service = new ImportExportService();
    const project = createDefaultProject();
    if (project.pageSetup) {
      project.pageSetup.dpi = 300;
    }
    const cardBody = project.layers
      .flatMap((layer) => layer.elements)
      .find((element) => element.id === 'card-body');
    if (cardBody?.type === 'rectangle') {
      cardBody.backgroundImage = 'data:image/png;base64,abc123';
      cardBody.backgroundImageX = 2;
      cardBody.backgroundImageY = 3;
      cardBody.backgroundImageWidth = 40;
      cardBody.backgroundImageHeight = 30;
      cardBody.backgroundImageFit = 'cover';
      cardBody.backgroundImageSizing = 'scale';
      cardBody.backgroundImageScale = 1.5;
      cardBody.backgroundImageNaturalWidth = 1920;
      cardBody.backgroundImageNaturalHeight = 1080;
    }

    const imported = service.importYaml(service.exportYaml(project));
    expect(imported.pageSetup?.dpi).toBe(300);
    const importedCardBody = imported.layers
      .flatMap((layer) => layer.elements)
      .find((element) => element.id === 'card-body');

    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImage : undefined)
      .toBe('data:image/png;base64,abc123');
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageX : undefined)
      .toBe(2);
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageY : undefined)
      .toBe(3);
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageWidth : undefined)
      .toBe(40);
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageHeight : undefined)
      .toBe(30);
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageFit : undefined)
      .toBe('cover');
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageSizing : undefined)
      .toBe('scale');
    expect(importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageScale : undefined)
      .toBe(1.5);
    expect(
      importedCardBody?.type === 'rectangle' ? importedCardBody.backgroundImageNaturalWidth : undefined,
    ).toBe(1920);
    expect(
      importedCardBody?.type === 'rectangle'
        ? importedCardBody.backgroundImageNaturalHeight
        : undefined,
    ).toBe(1080);
  });

  it('ignores removed legacy background placement fields from existing YAML', () => {
    const service = new ImportExportService();
    const imported = service.importYaml(`
version: 1
canvas:
  width: 148
  height: 210
  unit: mm
layers:
  - id: layer-1
    name: Layer 1
    elements:
      - id: rect-1
        layerId: layer-1
        type: rectangle
        name: Rectangle 1
        x: 0
        y: 0
        rotation: 0
        visible: true
        locked: false
        mode: additive
        fill: "#ffffff"
        stroke: "#000000"
        strokeWidth: 1
        backgroundImage: data:image/png;base64,abc123
        backgroundPlacement: legacy-pattern
        backgroundPositionX: 25
        backgroundPositionY: 50
        backgroundScale: 2
        backgroundRepeat: no-repeat
        width: 20
        height: 10
`);

    expect(imported.pageSetup).toBeUndefined();
    const rect = imported.layers[0].elements[0];
    expect(rect.type === 'rectangle' ? rect.backgroundImage : undefined)
      .toBe('data:image/png;base64,abc123');
    expect('backgroundPositionX' in rect).toBe(false);
    expect('backgroundScale' in rect).toBe(false);
  });

  it('defaults missing page setup dpi to 96', () => {
    const service = new ImportExportService();
    const imported = service.importYaml(`
version: 1
canvas:
  width: 148
  height: 210
  unit: mm
pageSetup:
  paperSize: A5
  orientation: portrait
  marginTop: 0
  marginBottom: 0
  marginLeft: 0
  marginRight: 0
  showPageBorder: true
layers: []
`);

    expect(imported.pageSetup?.dpi).toBe(96);
  });

  it('YAML import preserves grouped child elements', () => {
    const service = new ImportExportService();
    const project = createDefaultProject();
    project.layers[0].elements.push({
      id: 'group-1',
      layerId: 'layer-bottom-disc',
      type: 'group',
      name: 'Group 1',
      mode: 'additive',
      x: 0,
      y: 0,
      rotation: 0,
      visible: true,
      locked: false,
      elements: [
        {
          id: 'group-rect-1',
          layerId: 'layer-bottom-disc',
          type: 'rectangle',
          name: 'Grouped rectangle',
          mode: 'additive',
          x: 10,
          y: 12,
          rotation: 0,
          visible: true,
          locked: false,
          width: 20,
          height: 12,
          fill: '#ffffff',
          stroke: '#000000',
          strokeWidth: 1,
        },
      ],
    });

    const imported = service.importYaml(service.exportYaml(project));
    const group = imported.layers[0].elements.find((element) => element.type === 'group');

    expect(group?.type === 'group' ? group.elements[0]?.id : undefined).toBe('group-rect-1');
  });
});
