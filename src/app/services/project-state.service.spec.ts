import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject } from '../models/default-project';
import { ProjectStateService, getSelectableElements } from './project-state.service';

describe('ProjectStateService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists project changes between service instances', () => {
    const state = new ProjectStateService();

    state.updateCanvas({ width: 123 });

    expect(new ProjectStateService().project().canvas.width).toBe(123);
  });

  it('undoes and redoes project updates while restoring selection', () => {
    const state = new ProjectStateService();

    state.selectElement('card-body');
    state.updateElement('card-body', { x: 60 });

    expect(state.canUndo()).toBe(true);
    expect(state.findElement('card-body')?.element.x).toBe(60);

    expect(state.undo()).toBe(true);
    expect(state.findElement('card-body')?.element.x).toBe(45);
    expect(state.selectedElementId()).toBe('card-body');
    expect(state.canRedo()).toBe(true);

    expect(state.redo()).toBe(true);
    expect(state.findElement('card-body')?.element.x).toBe(60);
    expect(state.selectedElementId()).toBe('card-body');
  });

  it('undoes and redoes add, delete, reorder, paste, canvas, page setup, and setProject changes', () => {
    const state = new ProjectStateService();

    const layer = state.addLayer();
    expect(state.project().layers.map((candidate) => candidate.id)).toContain(layer.id);
    expect(state.undo()).toBe(true);
    expect(state.project().layers.map((candidate) => candidate.id)).not.toContain(layer.id);
    expect(state.redo()).toBe(true);
    expect(state.project().layers.map((candidate) => candidate.id)).toContain(layer.id);

    state.deleteElement('card-body');
    expect(state.findElement('card-body')).toBeNull();
    expect(state.undo()).toBe(true);
    expect(state.findElement('card-body')).not.toBeNull();

    const firstLayerId = state.project().layers[0].id;
    state.reorderLayer(0, 1);
    expect(state.project().layers[1].id).toBe(firstLayerId);
    expect(state.undo()).toBe(true);
    expect(state.project().layers[0].id).toBe(firstLayerId);

    expect(state.copyElement('card-body')).toBe(true);
    const pasted = state.pasteClipboard('layer-bottom-disc', 'card-body');
    const pastedId = pasted && !('elements' in pasted) ? pasted.id : null;
    expect(pastedId).toBeTruthy();
    expect(state.findElement(pastedId ?? '')).not.toBeNull();
    expect(state.undo()).toBe(true);
    expect(state.findElement(pastedId ?? '')).toBeNull();

    state.updateCanvas({ width: 123 });
    expect(state.project().canvas.width).toBe(123);
    expect(state.undo()).toBe(true);
    expect(state.project().canvas.width).toBe(210);

    state.updatePageSetup({ ...(state.project().pageSetup ?? createDefaultProject().pageSetup!), marginTop: 12 });
    expect(state.project().pageSetup?.marginTop).toBe(12);
    expect(state.undo()).toBe(true);
    expect(state.project().pageSetup?.marginTop).toBe(0);

    const importedProject = { ...createDefaultProject(), canvas: { width: 90, height: 80, unit: 'mm' as const } };
    state.setProject(importedProject);
    expect(state.project().canvas.width).toBe(90);
    expect(state.undo()).toBe(true);
    expect(state.project().canvas.width).toBe(210);
  });

  it('clears redo history after a new project mutation', () => {
    const state = new ProjectStateService();

    state.updateCanvas({ width: 123 });
    expect(state.undo()).toBe(true);
    expect(state.canRedo()).toBe(true);

    state.updateCanvas({ width: 124 });

    expect(state.canRedo()).toBe(false);
    expect(state.project().canvas.width).toBe(124);
  });

  it('does not create undo entries for locked no-op mutations', () => {
    const state = new ProjectStateService();

    state.updateElement('card-body', { locked: true });
    state.updateElement('card-body', { x: 99 });

    expect(state.findElement('card-body')?.element.x).toBe(45);
    expect(state.undo()).toBe(true);
    expect(state.findElement('card-body')?.element.locked).toBe(false);
    expect(state.canUndo()).toBe(false);
  });

  it('groups transaction updates into one undo step', () => {
    const state = new ProjectStateService();

    state.beginProjectTransaction();
    state.updateCanvas({ width: 111 });
    state.updateCanvas({ width: 112 });
    state.commitProjectTransaction();

    expect(state.project().canvas.width).toBe(112);
    expect(state.undo()).toBe(true);
    expect(state.project().canvas.width).toBe(210);
    expect(state.canUndo()).toBe(false);
  });

  it('limits undo history to 100 snapshots', () => {
    const state = new ProjectStateService();

    for (let width = 0; width <= 100; width += 1) {
      state.updateCanvas({ width });
    }

    for (let index = 0; index < 100; index += 1) {
      expect(state.undo()).toBe(true);
    }

    expect(state.project().canvas.width).toBe(0);
    expect(state.canUndo()).toBe(false);
  });

  it('loads the default project when stored project data is invalid', () => {
    localStorage.setItem('character-card-builder:current-project', JSON.stringify({ version: 999 }));

    const state = new ProjectStateService();

    expect(state.project().version).toBe(1);
    expect(state.project().layers.length).toBeGreaterThan(0);
  });

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

  it('allows selecting but not editing, moving, or deleting locked elements', () => {
    const state = new ProjectStateService();

    state.updateElement('card-body', { locked: true });
    state.selectElement('card-body');
    state.updateElement('card-body', { x: 99 });
    state.moveElementInEditMode('card-body', 5, 5);
    state.deleteElement('card-body');

    const element = state.findElement('card-body')?.element;
    expect(state.selectedElementId()).toBe('card-body');
    expect(element).toMatchObject({ id: 'card-body', x: 45, y: 34, locked: true });
  });

  it('allows selecting but not editing elements on locked layers', () => {
    const state = new ProjectStateService();

    state.updateLayer('layer-top-card', { locked: true });
    state.selectElement('card-body');
    state.updateElement('card-body', { x: 99 });

    expect(state.selectedElementId()).toBe('card-body');
    expect(state.findElement('card-body')?.element.x).toBe(45);
  });

  it('allows locked elements to update opacity', () => {
    const state = new ProjectStateService();

    state.updateElement('card-body', { locked: true });
    state.updateElement('card-body', { opacity: 0.4 });

    expect(state.findElement('card-body')?.element.opacity).toBe(0.4);
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

  it('deletes a layer and clears matching selections', () => {
    const state = new ProjectStateService();

    state.selectElement('card-body');

    expect(state.deleteLayer('layer-top-card')).toBe(true);
    expect(state.project().layers.map((layer) => layer.id)).not.toContain('layer-top-card');
    expect(state.selectedLayerId()).toBe('layer-bottom-disc');
    expect(state.selectedElementId()).toBeNull();
  });

  it('does not delete locked layers', () => {
    const state = new ProjectStateService();

    state.updateLayer('layer-top-card', { locked: true });

    expect(state.deleteLayer('layer-top-card')).toBe(false);
    expect(state.project().layers.map((layer) => layer.id)).toContain('layer-top-card');
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

  it('copies and pastes a layer with new layer and element ids', () => {
    const state = new ProjectStateService();
    const initialLayerCount = state.project().layers.length;

    expect(state.copyLayer('layer-top-card')).toBe(true);
    const pasted = state.pasteClipboard('layer-top-card', null);

    expect(pasted && 'elements' in pasted ? pasted.id : null).not.toBe('layer-top-card');
    expect(state.project().layers).toHaveLength(initialLayerCount + 1);
    expect(state.selectedLayerId()).toBe(pasted && 'elements' in pasted ? pasted.id : null);
    expect(
      pasted && 'elements' in pasted
        ? pasted.elements.every((element) => element.layerId === pasted.id && element.id !== 'card-body')
        : false,
    ).toBe(true);
  });

  it('copies and pastes an element into the selected layer', () => {
    const state = new ProjectStateService();

    expect(state.copyElement('card-body')).toBe(true);
    const pasted = state.pasteClipboard('layer-bottom-disc', 'card-body');

    const pastedElement = pasted && !('elements' in pasted) ? pasted : null;
    const bottomLayer = state.project().layers.find((layer) => layer.id === 'layer-bottom-disc');

    expect(pastedElement?.id).toBeTruthy();
    expect(pastedElement?.id).not.toBe('card-body');
    expect(pastedElement?.name).toBe('Card body copy');
    expect(pastedElement?.layerId).toBe('layer-bottom-disc');
    expect(pastedElement).toMatchObject({ x: 49, y: 38 });
    expect(bottomLayer?.elements.at(-1)?.id).toBe(pastedElement?.id);
    expect(state.selectedElementId()).toBe(pastedElement?.id);
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
