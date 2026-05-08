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

  it('rotates a shape around a configured interaction pivot in view mode', () => {
    const state = new ProjectStateService();

    state.setMode('view');
    state.rotateElementAroundPivotInViewMode('gear-main', 'gear-rotation', 90);

    const updated = state.findElement('gear-main')?.element;
    expect(updated?.x).toBe(135);
    expect(updated?.y).toBe(56);
    expect(updated?.rotation).toBe(0);
    expect(updated ? state.elementViewTransform(updated).rotation : undefined).toBe(90);
  });

  it('slides a shape along a configured axis in view mode', () => {
    const state = new ProjectStateService();

    state.updateElement('card-body', {
      interactions: [
        {
          id: 'card-slide',
          type: 'slide',
          name: 'Slide axis',
          visible: true,
          startX: -10,
          startY: 0,
          endX: 10,
          endY: 0,
        },
      ],
    });
    state.setMode('view');
    state.slideElementAlongAxisInViewMode('card-body', 'card-slide', 7, 5);

    const updated = state.findElement('card-body')?.element;
    expect(updated).toMatchObject({ x: 45, y: 34 });
    expect(updated ? state.elementViewTransform(updated) : null).toMatchObject({ x: 52, y: 34 });
  });

  it('clears transient view transforms when returning to edit mode', () => {
    const state = new ProjectStateService();

    state.setMode('view');
    state.rotateElementAroundPivotInViewMode('gear-main', 'gear-rotation', 90);
    state.setMode('edit');

    const gear = state.findElement('gear-main')?.element;
    expect(gear ? state.elementViewTransform(gear).rotation : undefined).toBe(0);
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

  it('prevents locked elements from being selected, edited, moved, or deleted', () => {
    const state = new ProjectStateService();

    state.updateElement('card-body', { locked: true });
    state.selectElement('card-body');
    state.updateElement('card-body', { x: 99 });
    state.moveElementInEditMode('card-body', 5, 5);
    state.deleteElement('card-body');

    const element = state.findElement('card-body')?.element;
    expect(state.selectedElementId()).toBeNull();
    expect(element).toMatchObject({ id: 'card-body', x: 45, y: 34, locked: true });
  });

  it('prevents locked gears from rotating in view mode', () => {
    const state = new ProjectStateService();

    state.updateElement('gear-main', { locked: true });
    state.setMode('view');
    state.rotateGearInViewMode('gear-main', 45);

    const gear = state.findElement('gear-main')?.element;
    expect(gear?.type === 'gear' ? gear.currentRotation : undefined).toBe(0);
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

  it('adds a text element with editable font defaults', () => {
    const state = new ProjectStateService();

    state.selectLayer('layer-top-card');
    const element = state.addElementToSelectedLayer('text');

    expect(element).toMatchObject({
      type: 'text',
      text: 'Text',
      fontSize: 8,
      fontFamily: 'Arial, sans-serif',
      fontWeight: '400',
      fill: '#2f332f',
      align: 'middle',
    });
    expect(state.selectedElementId()).toBe(element?.id);
  });

  it('adds elements to the selected group', () => {
    const state = new ProjectStateService();

    state.selectLayer('layer-top-card');
    const group = state.addElementToSelectedLayer('group');
    const rectangle = state.addElementToSelectedLayer('rectangle');
    const updatedGroup = group ? state.findElement(group.id)?.element : null;

    expect(group?.type).toBe('group');
    expect(rectangle?.type).toBe('rectangle');
    expect(
      updatedGroup?.type === 'group' ? updatedGroup.elements.map((element) => element.id) : [],
    ).toContain(rectangle?.id);
    expect(state.findElement(rectangle?.id ?? '')?.element.id).toBe(rectangle?.id);
  });

  it('reorders layers', () => {
    const state = new ProjectStateService();
    const firstLayerId = state.project().layers[0].id;

    state.reorderLayer(0, 1);

    expect(state.project().layers[1].id).toBe(firstLayerId);
  });

  it('moves an element between layers', () => {
    const state = new ProjectStateService();

    state.moveElementToContainer('card-body', { kind: 'layer', layerId: 'layer-bottom-disc' }, 0);

    expect(state.project().layers[0].elements[0].id).toBe('card-body');
    expect(state.findElement('card-body')?.layer.id).toBe('layer-bottom-disc');
  });

  it('does not move locked elements between containers', () => {
    const state = new ProjectStateService();

    state.updateElement('card-body', { locked: true });
    state.moveElementToContainer('card-body', { kind: 'layer', layerId: 'layer-bottom-disc' }, 0);

    expect(state.findElement('card-body')?.layer.id).toBe('layer-top-card');
  });

  it('reorders elements inside a group', () => {
    const state = new ProjectStateService();

    state.selectLayer('layer-top-card');
    const group = state.addElementToSelectedLayer('group');
    const rectangle = state.addElementToSelectedLayer('rectangle');
    state.selectElement(group?.id ?? null);
    const circle = state.addElementToSelectedLayer('circle');

    expect(group?.type).toBe('group');
    state.reorderElements({ kind: 'group', groupId: group?.id ?? '' }, 1, 0);

    const updatedGroup = group ? state.findElement(group.id)?.element : null;
    expect(updatedGroup?.type === 'group' ? updatedGroup.elements[0].id : undefined).toBe(
      circle?.id,
    );
    expect(rectangle?.id).toBeTruthy();
  });
});
