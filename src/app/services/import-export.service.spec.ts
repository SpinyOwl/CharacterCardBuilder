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
