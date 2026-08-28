# @atlasmechanica/renderer-svg

Production 2D renderer for Atlas Mechanica.

The renderer consumes `MechanismScene` from `@atlasmechanica/scene` and owns only presentation and interaction. It does not import simulation adapters, solve mechanism geometry, or mutate physical state.

```ts
const renderer = createSvgMechanismRenderer(host, {
  instanceId: 'lesson-main',
  callbacks: {
    onSelect(id) {},
    onInputDrag(point) {},
    onParameterDrag(point) {},
    onNudgeInput(deltaDegrees) {},
  },
});

renderer.update(scene);
const markup = renderer.exportSvg();
renderer.destroy();
```

`instanceId` is required so SVG `<defs>` identifiers are deterministic and safe when several diagrams share a document. Animation and reduced-motion policy live above this package; the renderer only reflects the immutable scene it is given.
