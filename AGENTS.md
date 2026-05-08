# Agent Guide

This document is for coding agents working in this repository. Keep changes narrow, preserve existing Angular patterns, and verify with tests/build before committing.

## Project Basics

- Framework: Angular 21 standalone components.
- State: Angular signals in `ProjectStateService`.
- UI primitives: Angular Aria menu, toolbar, and tree.
- Persistence: YAML import/export through `ImportExportService`.
- Rendering: SVG in `CanvasStageComponent`.
- Tests: Vitest.

## High-Value Files

- `src/app/app.ts`
  - Shell component logic, inspector update handlers, project tree model, dialogs, toolbar/menu actions.
- `src/app/app.html`
  - Main editor template.
- `src/app/app.css`
  - Main layout, panels, tree, dialogs, inspector styles.
- `src/app/canvas-stage/canvas-stage.component.ts`
  - Canvas interaction, render segmentation, geometry hit testing, transforms.
- `src/app/canvas-stage/canvas-stage.component.html`
  - SVG rendering for all element types, masks, cutout strokes, edit helpers.
- `src/app/models/element.model.ts`
  - Element union. Update this first when adding or changing element fields.
- `src/app/services/project-state.service.ts`
  - Mutations and editing rules. Do not bypass it from UI code except through existing service methods.
- `src/app/services/import-export.service.ts`
  - Keep YAML imports backward-compatible for new optional fields when practical.

## Current Domain Rules

- Coordinates and canvas sizes are in millimeters.
- Element order is visual stacking order.
- Layers are scoped compositing groups. Subtractive elements only cut content in their own layer.
- Subtractive behavior is order-based:
  - subtractive elements cut additive elements before them;
  - later additive elements render above the cutout;
  - later additive elements must remain selectable/movable.
- Cutout stroke is visible only where the subtractive shape touches affected additive content.
- Text elements are additive-only for subtractive rendering.
- Locked elements cannot be edited, moved, or rotated. Lock/unlock controls are allowed to update lock state.
- Groups are containers for ordered elements. Group child order participates in rendering.
- Left-panel drag/drop ordering was intentionally removed.
- Gear rendering should not include a large internal circle. Use the editable center dot instead.
- Gear labels are edited as independent label records on the gear, with text-style fields similar to text elements.

## Implementation Guidance

- Prefer extending the existing element union and service update patterns.
- For new element fields:
  - update `element.model.ts`;
  - update defaults in `default-project.ts` and `ProjectStateService.createElement`;
  - update YAML validation/import defaults in `ImportExportService`;
  - update rendering in `CanvasStageComponent`;
  - update inspector controls in `app.html`/`app.ts`;
  - add or adjust tests when behavior is nontrivial.
- Keep Angular templates type-safe. If a union type is too broad in a template, add a small type-safe helper in the component instead of using loose casts in markup.
- Avoid global refactors while implementing feature requests.
- Do not reintroduce tree drag/drop without explicit request.

## Verification

Run these before committing:

```bash
npm test -- --run
npm run build
```

If either command cannot run, state the blocker in the final response.

## Deployment

- Cloudflare Pages deployment is configured through `wrangler.toml`.
- The production build output is `dist/character-card-builder/browser`.
- Use `npm run deploy:cloudflare` to build and upload with Wrangler.
- The custom domain is `character-card-builder.spinyowl.com`; domain attachment is handled in Cloudflare Pages Custom domains.
- Do not commit API tokens or account-specific secrets.

## Git

- Check `git status --short` before editing and before committing.
- Do not revert user changes unless explicitly asked.
- Commit related changes together with a direct message, for example:
  - `Add editable gear labels and center dot`
  - `Clip cutout strokes to additive content`
