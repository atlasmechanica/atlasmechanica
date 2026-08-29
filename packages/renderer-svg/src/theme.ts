export interface SvgRendererTheme {
  background: string;
  foreground: string;
  muted: string;
  ground: string;
  accent: string;
  vector: string;
  trace: string;
  danger: string;
}

export const DEFAULT_SVG_RENDERER_THEME: SvgRendererTheme = {
  background: '#fbfaf6',
  foreground: '#191917',
  muted: '#74716a',
  ground: '#97938a',
  accent: '#c45c38',
  vector: '#365e7d',
  trace: '#9d998f',
  danger: '#a43e35',
};

export const SVG_RENDERER_STYLE = `
.atlas-svg-root { background: var(--am-background); overflow: visible; touch-action: none; }
.atlas-layer { pointer-events: none; }
.atlas-primitive { pointer-events: none; }
.atlas-visible { vector-effect: non-scaling-stroke; fill: none; stroke: var(--am-foreground); }
.atlas-style-ground { stroke: var(--am-ground); }
.atlas-style-body { stroke: var(--am-foreground); }
.atlas-style-joint { stroke: var(--am-foreground); fill: var(--am-background); }
.atlas-style-tracer { stroke: var(--am-accent); fill: var(--am-background); }
.atlas-style-belt { stroke: var(--am-vector); }
.atlas-style-pulley { stroke: var(--am-accent); fill: none; }
.atlas-style-trace { stroke: var(--am-trace); opacity: .72; }
.atlas-style-vector { stroke: var(--am-vector); color: var(--am-vector); }
.atlas-style-dimension { stroke: var(--am-muted); }
.atlas-style-label { fill: var(--am-muted); stroke: none; font: 12px ui-sans-serif, system-ui, sans-serif; }
.atlas-style-handle { stroke: var(--am-accent); fill: var(--am-background); }
.atlas-style-invalid { stroke: var(--am-danger); fill: var(--am-background); stroke-dasharray: 4 3; }
.atlas-style-cutout { stroke: var(--am-background); }
.atlas-primitive[data-primitive="belt-driver-rim-inner"] .atlas-visible,
.atlas-primitive[data-primitive="belt-driven-rim-inner"] .atlas-visible,
.atlas-primitive[data-primitive="belt-driver-hub"] .atlas-visible,
.atlas-primitive[data-primitive="belt-driven-hub"] .atlas-visible,
.atlas-primitive[data-primitive^="belt-driver-spoke-"]:not([data-primitive^="belt-driver-spoke-core-"]) .atlas-visible,
.atlas-primitive[data-primitive^="belt-driven-spoke-"]:not([data-primitive^="belt-driven-spoke-core-"]) .atlas-visible {
  stroke: var(--am-accent);
}
.atlas-selected { stroke: var(--am-accent); filter: drop-shadow(0 0 1.5px var(--am-accent)); }
.atlas-hit { stroke: transparent; fill: transparent; pointer-events: none; }
.atlas-hit-fill { stroke: transparent; fill: transparent; pointer-events: none; }
.atlas-interactive { pointer-events: all; cursor: pointer; }
.atlas-interactive .atlas-hit { pointer-events: stroke; }
.atlas-interactive .atlas-hit-fill { pointer-events: all; }
.atlas-interactive:focus .atlas-visible { stroke: var(--am-accent); filter: drop-shadow(0 0 2px var(--am-accent)); }
.atlas-interactive:focus { outline: none; }
.atlas-handle-visible { vector-effect: non-scaling-stroke; stroke-width: 2; }
.atlas-dimension-text { fill: var(--am-muted); stroke: none; font: 12px ui-sans-serif, system-ui, sans-serif; }
`;

export function applySvgTheme(
  svg: SVGSVGElement,
  theme: Partial<SvgRendererTheme> = {},
): void {
  const resolved = { ...DEFAULT_SVG_RENDERER_THEME, ...theme };
  svg.style.setProperty('--am-background', resolved.background);
  svg.style.setProperty('--am-foreground', resolved.foreground);
  svg.style.setProperty('--am-muted', resolved.muted);
  svg.style.setProperty('--am-ground', resolved.ground);
  svg.style.setProperty('--am-accent', resolved.accent);
  svg.style.setProperty('--am-vector', resolved.vector);
  svg.style.setProperty('--am-trace', resolved.trace);
  svg.style.setProperty('--am-danger', resolved.danger);
}
