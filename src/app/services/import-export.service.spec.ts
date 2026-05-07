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
});
