import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../models/default-project';
import { ProjectStateService, getSelectableElements } from './project-state.service';

describe('ProjectStateService', () => {
  it('edit mode drag moves gear instead of rotating it', () => {
    const state = new ProjectStateService();
    const gear = state.findElement('gear-main')?.element;
    expect(gear?.type).toBe('gear');

    state.setMode('edit');
    state.moveElementInEditMode('gear-main', 5, -3);

    const updated = state.findElement('gear-main')?.element;
    expect(updated).toMatchObject({ x: 140, y: 53 });
    expect(updated?.type === 'gear' ? updated.currentRotation : undefined).toBe(0);
  });

  it('view mode drag rotates gear instead of moving it', () => {
    const state = new ProjectStateService();

    state.setMode('view');
    state.rotateGearInViewMode('gear-main', 45);

    const updated = state.findElement('gear-main')?.element;
    expect(updated).toMatchObject({ x: 135, y: 56 });
    expect(updated?.type === 'gear' ? updated.currentRotation : undefined).toBe(45);
  });

  it('hidden layers are not selectable', () => {
    const project = createDefaultProject();
    project.layers[0] = { ...project.layers[0], visible: false };
    const state = new ProjectStateService();
    state.setProject(project);

    const selectableIds = getSelectableElements(project).map((element) => element.id);

    expect(state.visibleLayers().map((layer) => layer.id)).not.toContain('layer-bottom-disc');
    expect(selectableIds).not.toContain('gear-main');
    expect(selectableIds).toContain('card-body');
  });

  it('deletes an element and clears matching selection', () => {
    const state = new ProjectStateService();

    state.selectElement('card-body');
    state.deleteElement('card-body');

    expect(state.findElement('card-body')).toBeNull();
    expect(state.selectedElementId()).toBeNull();
  });

  it('adds a new layer and selects it', () => {
    const state = new ProjectStateService();
    const initialLayerCount = state.project().layers.length;

    const layer = state.addLayer();

    expect(state.project().layers).toHaveLength(initialLayerCount + 1);
    expect(state.selectedLayerId()).toBe(layer.id);
    expect(layer.elements).toHaveLength(0);
  });

  it('adds an element to the selected layer and selects it', () => {
    const state = new ProjectStateService();

    state.selectLayer('layer-top-card');
    const element = state.addElementToSelectedLayer('rectangle');

    expect(element?.type).toBe('rectangle');
    expect(element?.layerId).toBe('layer-top-card');
    expect(state.selectedElementId()).toBe(element?.id);
    expect(state.findElement(element?.id ?? '')?.layer.id).toBe('layer-top-card');
  });
});
