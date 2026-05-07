import { describe, expect, it } from 'vitest';
import { createDefaultProject } from './default-project';

describe('default project', () => {
  it('contains at least two layers', () => {
    expect(createDefaultProject().layers.length).toBeGreaterThanOrEqual(2);
  });

  it('has one gear element', () => {
    const gears = createDefaultProject().layers.flatMap((layer) =>
      layer.elements.filter((element) => element.type === 'gear'),
    );

    expect(gears).toHaveLength(1);
  });

  it('has one subtractive window element', () => {
    const windows = createDefaultProject().layers.flatMap((layer) =>
      layer.elements.filter(
        (element) => element.type === 'rectangle' && element.mode === 'subtractive',
      ),
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]?.name).toBe('Window');
  });
});
