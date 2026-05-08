# Project Map

CharacterCardBuilder is a standalone Angular 21 application for building layered SVG character-card layouts. The editor uses millimeter-based canvas coordinates, Angular signals for project state, Angular Aria for menu/toolbar/tree widgets, YAML for project import/export, and Vitest for focused unit coverage.

## Runtime Shape

- `src/main.ts` bootstraps the standalone root component.
- `src/app/app.ts` is the application shell and inspector controller. It owns menubar actions, toolbar actions, project tree projection, page setup, import/export dialog state, and selection inspector update methods.
- `src/app/app.html` renders the full editor UI: menubar, toolbar, layer/tree side panel, canvas stage, inspector panel, import/export dialog, and page setup dialog.
- `src/app/app.css` contains shell, panel, tree, inspector, dialog, and control styling.
- `src/app/canvas-stage/` contains the SVG canvas component. It renders layers/elements, handles pointer interaction on the stage, edit-mode helpers, rectangle resizing, gear rotation in view mode, subtractive cutouts, and cutout stroke rendering.

## Data Model

- `src/app/models/project.model.ts`
  - Project-level shape: version, canvas settings, page setup, layers, editor metadata, app mode.
- `src/app/models/layer.model.ts`
  - Layer shape: id, name, visibility, lock state, opacity, ordered elements.
- `src/app/models/element.model.ts`
  - Element union types: rectangle, circle, triangle, polygon, text, gear, group.
  - Shared element fields: id, layerId, type, name, position, rotation, visibility, lock state, additive/subtractive mode.
  - Shape style fields: fill, stroke, strokeWidth, optional backgroundImage.
  - Gear-specific fields: tooth geometry, runtime rotation, editable center dot, editable labels.
- `src/app/models/default-project.ts`
  - Initial sample project with a bottom rotating gear layer and top card layer with subtractive window.

## State And Services

- `src/app/services/project-state.service.ts`
  - Single source of truth for project state, selected layer/element, editor mode, visible layers, selectable elements.
  - Handles adding layers/elements, groups, moving elements, layer/element reordering helpers, canvas/page setup updates, locking rules, edit-mode movement, and view-mode gear rotation.
- `src/app/services/import-export.service.ts`
  - YAML serialization and validation. Import code is intentionally strict for required geometry/style fields and tolerant for newer optional/defaultable fields.
- `src/app/services/export.service.ts`
  - Browser download helpers and SVG serialization.

## Rendering Notes

- Layer order and element order are visual stacking order.
- Groups flatten into visual order for rendering and hit testing; group children keep their own order.
- Additive elements render normally.
- Subtractive elements render as order-based cutouts scoped to their current layer:
  - a subtractive element cuts additive content that appears before it in the same layer;
  - additive elements after the subtractive element render normally and can cover the cutout;
  - text remains additive-only for masking purposes.
- Cutout strokes are clipped to the additive batch they affect, so the stroke only appears where additive and subtractive geometry touch.
- Edit-mode subtractive helper outlines are separate from exported/rendered cutout strokes.
- Gears render as a single gear path plus an editable center dot and editable labels. The former large internal circle is intentionally not rendered.

## UI Features

- File menubar:
  - Open project
  - Save project
  - Import/export
  - Page setup
- Toolbar:
  - Add layer
  - Add rectangle, circle, triangle, gear, text, group
  - Edit/view mode toggle
- Project tree:
  - Uses Angular Aria tree.
  - Shows layers, groups, and elements with Material Symbols icons.
  - Provides icon-only visibility, lock, and delete controls.
  - Drag/drop ordering was removed from the left panel by request.
- Inspector:
  - Common fields: type, name, x, y, rotation, boolean mode.
  - Shape fields: fill, stroke, stroke thickness, background image.
  - Rectangle fields: width, height, radius.
  - Gear fields: disc/tooth/teeth/runtime rotation, center dot styling, per-label editing.
  - Text fields: text, color, size, weight, align, font family.

## Utilities

- `src/app/utils/geometry.utils.ts`
  - Geometry helpers, point utilities, rounded rectangle path, triangle path, polygon path, rotation normalization.
- `src/app/utils/gear.utils.ts`
  - Gear SVG path generation from disc radius, tooth height, tooth count, tooth width, and tooth shape.
- `src/app/utils/svg-path.utils.ts`
  - Low-level SVG path command helpers.

## Tests

- `src/app/services/project-state.service.spec.ts`
  - State behavior: edit/view gear movement, selectable/locked behavior, text defaults, etc.
- `src/app/services/import-export.service.spec.ts`
  - YAML import/export validation behavior.
- `src/app/models/default-project.spec.ts`
  - Default project assumptions.
- `src/app/utils/geometry.utils.spec.ts`
  - Geometry/path utility behavior.

## Commands

```bash
npm test -- --run
npm run build
npm start
npm run deploy:cloudflare
```

Use `npm test -- --run` and `npm run build` before committing behavior or template changes.

## Deployment

- `wrangler.toml` configures Cloudflare Pages direct upload for project `character-card-builder`.
- `public/_redirects` provides the Pages SPA fallback.
- `CLOUDFLARE_DEPLOYMENT.md` documents deployment to `character-card-builder.spinyowl.com`.
- Cloudflare upload command is wrapped by `npm run deploy:cloudflare`.
