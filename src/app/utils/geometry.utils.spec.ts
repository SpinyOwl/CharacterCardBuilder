import { describe, expect, it } from 'vitest';
import { roundedRectPath } from './geometry.utils';
import { createGearPath } from './gear.utils';

describe('geometry utilities', () => {
  it('createGearPath returns a valid closed SVG path', () => {
    const path = createGearPath({
      discRadius: 24,
      toothHeight: 8,
      teeth: 16,
      toothWidth: 55,
      toothShape: 60,
    });

    expect(path).toMatch(/^M /);
    expect(path.trim()).toMatch(/Z$/);
    expect(path).toContain('A ');
    expect(path).toContain('L ');
  });

  it('roundedRectPath returns a valid closed path', () => {
    const path = roundedRectPath(120, 80, 6);

    expect(path).toMatch(/^M /);
    expect(path.trim()).toMatch(/Z$/);
    expect(path).toContain('A 6 6');
  });
});
