import { panCanvas } from './canvasScrollbars';

/** Largest zoom Fit Route goes to, so a route of one or two steps does not fill the screen. */
export const MAX_FIT_SCALE = 2.5;
/** Room left around the fitted route, in screen pixels, on each side. */
const FIT_PADDING = 40;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FitMove {
  /** How far to move the view (screen pixels; positive scrolls right and down) to centre the content. */
  dx: number;
  dy: number;
  /** What to multiply the current zoom by. */
  factor: number;
}

/**
 * How to bring `content` (on screen, at zoom `scale`) to the middle of `view` as large as it fits,
 * at most at `maxScale`. Unlike Kaoto's Fit to Screen, which never goes past 100%, this zooms in.
 */
export function fitMove(view: Box, content: Box, scale: number, maxScale = MAX_FIT_SCALE): FitMove | undefined {
  if (content.width <= 0 || content.height <= 0 || view.width <= 0 || view.height <= 0 || scale <= 0) return undefined;
  const room = (size: number) => Math.max(1, size - FIT_PADDING * 2);
  const fits = Math.min(room(view.width) / content.width, room(view.height) / content.height);
  const target = Math.min(scale * fits, maxScale);
  return {
    dx: content.left + content.width / 2 - (view.left + view.width / 2),
    dy: content.top + content.height / 2 - (view.top + view.height / 2),
    factor: target / scale,
  };
}

/** Kaoto's canvas: the one on screen, not the hidden copy it draws "export image" on. */
export function canvasSvg(root: ParentNode): SVGSVGElement | null {
  return root.querySelector<SVGSVGElement>('.pf-topology-visualization-surface:not(.hidden-canvas *) > svg');
}

/**
 * Zooms Kaoto's canvas so the route `groupId` (as selectedRoute.ts names it, e.g. `get-order|route`)
 * fills it, or the whole flow when no route is given. Kaoto has no way to resize a route's box (its
 * layout sizes each route to its steps), so this is how a route is made bigger.
 *
 * The canvas is d3's zoom on the `svg`: the view is first moved so the route is in the middle
 * (panCanvas), then zoomed about the middle by a mouse wheel turn there, which d3 turns into
 * zoom by 2^(-deltaY * 0.002).
 */
export function fitRoute(root: ParentNode, groupId?: string) {
  const svg = canvasSvg(root);
  if (!svg) return;
  const target = groupId
    ? svg.querySelector(`g[data-id=${JSON.stringify(groupId)}]`)
    : svg.querySelector("g[data-kind='graph'] > g[data-surface]");
  if (!target) return;
  const view = svg.getBoundingClientRect();
  const scale = (svg as SVGSVGElement & { __zoom?: { k: number } }).__zoom?.k ?? 1;
  const move = fitMove(view, target.getBoundingClientRect(), scale);
  if (!move) return;
  panCanvas(svg, move.dx, move.dy);
  if (Math.abs(Math.log2(move.factor)) < 0.001) return;
  svg.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: -Math.log2(move.factor) / 0.002,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      clientX: view.left + view.width / 2,
      clientY: view.top + view.height / 2,
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  );
}
