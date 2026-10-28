/** Smallest thumb, in pixels, so a long flow still has one to grab. */
const MIN_THUMB = 28;
/** The bars' thickness and padding, as in KaotoEditorHost.css. */
const TRACK_WIDTH = 12;
const TRACK_PADDING = 2;

export interface ThumbGeometry {
  /** Thumb length and offset along the track, in pixels. */
  size: number;
  offset: number;
  /** How far the diagram moves for each pixel the thumb moves. */
  ratio: number;
}

/**
 * Where the thumb sits along one axis. `viewStart`/`viewEnd` are the canvas's visible edges and
 * `contentStart`/`contentEnd` the diagram's, all in screen pixels; the scrollable extent covers
 * both, so the diagram can be dragged past its edge and the thumb still shows where the view is.
 * Undefined when the diagram fits: then there is nothing to scroll and no bar shows.
 */
export function thumbGeometry(viewStart: number, viewEnd: number, contentStart: number, contentEnd: number, track: number): ThumbGeometry | undefined {
  const view = viewEnd - viewStart;
  const lo = Math.min(viewStart, contentStart);
  const hi = Math.max(viewEnd, contentEnd);
  const hidden = hi - lo - view;
  if (hidden < 1 || track <= 0) return undefined;
  const size = Math.min(track, Math.max(MIN_THUMB, (track * view) / (hi - lo)));
  const free = track - size;
  const offset = free > 0 ? ((viewStart - lo) / hidden) * free : 0;
  return { size, offset, ratio: free > 0 ? hidden / free : 0 };
}

type Axis = 'x' | 'y';

/**
 * Moves the view of Kaoto's canvas (its `svg`) by (dx, dy) screen pixels: positive scrolls right
 * and down. It is the drag on the canvas background a person would make: Kaoto's pan handler is
 * d3's, which listens on the diagram for mousedown and on the window for mousemove and mouseup.
 */
export function panCanvas(svg: SVGSVGElement, dx: number, dy: number) {
  const target = svg.querySelector<SVGElement>("g[data-kind='graph'] > rect");
  if (!target || (!dx && !dy)) return;
  const box = target.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const init = (clientX: number, clientY: number) => ({ clientX, clientY, button: 0, buttons: 1, bubbles: true, cancelable: true, view: window });
  target.dispatchEvent(new MouseEvent('mousedown', init(x, y)));
  window.dispatchEvent(new MouseEvent('mousemove', init(x - dx, y - dy)));
  window.dispatchEvent(new MouseEvent('mouseup', { ...init(x - dx, y - dy), buttons: 0 }));
}

/**
 * Kaoto's Design canvas is a PatternFly topology diagram: it is moved by dragging its background
 * and has no scroll bars, so a flow taller or wider than the canvas (e.g. many operation routes)
 * runs off the edge with no sign of more. This adds a vertical bar along the canvas's right edge
 * (next to the split with the step form) and a horizontal one along its bottom, shown only while
 * part of the diagram is out of view. Dragging a thumb, clicking a track or turning the mouse
 * wheel over a bar moves the diagram (panCanvas). Returns a cleanup function.
 */
export function trackCanvasScrollbars(container: HTMLElement) {
  const bars = document.createElement('div');
  bars.className = 'echo-canvas-scrollbars';
  bars.setAttribute('aria-hidden', 'true');
  const make = (axis: Axis) => {
    const track = document.createElement('div');
    track.className = `echo-canvas-scrollbar echo-canvas-scrollbar--${axis === 'y' ? 'vertical' : 'horizontal'}`;
    track.dataset.testid = `canvas-scrollbar-${axis}`;
    const thumb = document.createElement('div');
    thumb.className = 'echo-canvas-scrollbar__thumb';
    track.appendChild(thumb);
    bars.appendChild(track);
    return { axis, track, thumb, geometry: undefined as ThumbGeometry | undefined };
  };
  const vertical = make('y');
  const horizontal = make('x');

  let surface: HTMLElement | null = null;
  const svg = () => surface?.querySelector<SVGSVGElement>(':scope > svg') ?? null;
  const diagram = () => svg()?.querySelector<SVGGElement>("g[data-kind='graph'] > g[data-surface]") ?? null;

  const scrollBy = (dx: number, dy: number) => {
    const canvas = svg();
    if (canvas) panCanvas(canvas, dx, dy);
  };

  const place = () => {
    const view = svg()?.getBoundingClientRect();
    const content = diagram()?.getBoundingClientRect();
    const shown = !!view && !!content && content.width > 0 && content.height > 0;
    const geometry = (y: boolean, corner: number) => {
      if (!shown || !view || !content) return undefined;
      // The track runs along the canvas, less its padding and the corner the other bar takes.
      const length = (y ? view.height : view.width) - TRACK_PADDING * 2 - corner;
      return y
        ? thumbGeometry(view.top, view.bottom, content.top, content.bottom, length)
        : thumbGeometry(view.left, view.right, content.left, content.right, length);
    };
    const both = !!geometry(true, 0) && !!geometry(false, 0);
    for (const bar of [vertical, horizontal]) {
      const y = bar.axis === 'y';
      bar.geometry = geometry(y, both ? TRACK_WIDTH : 0);
      bar.track.hidden = !bar.geometry;
      if (!bar.geometry) continue;
      bar.thumb.style[y ? 'height' : 'width'] = `${bar.geometry.size}px`;
      bar.thumb.style.transform = y ? `translateY(${bar.geometry.offset}px)` : `translateX(${bar.geometry.offset}px)`;
    }
    bars.classList.toggle('echo-canvas-scrollbars--both', both);
  };
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), place()));
  };

  for (const bar of [vertical, horizontal]) {
    const y = bar.axis === 'y';
    const along = (event: MouseEvent) => (y ? event.clientY : event.clientX);
    bar.thumb.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      let last = along(event);
      bar.track.classList.add('echo-canvas-scrollbar--dragging');
      const move = (e: MouseEvent) => {
        // Kaoto's own (synthetic) drag events reach the window too; follow only the person's.
        if (!e.isTrusted) return;
        const delta = (along(e) - last) * (bar.geometry?.ratio ?? 0);
        last = along(e);
        if (y) scrollBy(0, delta);
        else scrollBy(delta, 0);
      };
      const up = (e: MouseEvent) => {
        if (!e.isTrusted) return;
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        bar.track.classList.remove('echo-canvas-scrollbar--dragging');
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
    // A click on the track pages towards it, like a browser's scroll bar.
    bar.track.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target !== bar.track || !bar.geometry) return;
      event.preventDefault();
      const view = svg()?.getBoundingClientRect();
      if (!view) return;
      const thumb = bar.thumb.getBoundingClientRect();
      const page = 0.9 * (y ? view.height : view.width);
      const before = along(event) < (y ? thumb.top : thumb.left);
      if (y) scrollBy(0, before ? -page : page);
      else scrollBy(before ? -page : page, 0);
    });
    bar.track.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const delta = y ? event.deltaY || event.deltaX : event.deltaX || event.deltaY;
        if (y) scrollBy(0, delta);
        else scrollBy(delta, 0);
      },
      { passive: false },
    );
  }

  // The bars sit over the canvas's own element; it comes and goes with the Design view. The
  // diagram moves by its transform, and changes size as steps and routes are added.
  const watch = new MutationObserver(schedule);
  const resize = new ResizeObserver(schedule);
  const attach = () => {
    const found = container.querySelector<HTMLElement>('.pf-topology-visualization-surface:not(.hidden-canvas *)');
    if (found && found !== surface) {
      surface = found;
      surface.appendChild(bars);
      watch.disconnect();
      resize.disconnect();
      const canvas = svg();
      if (canvas) watch.observe(canvas, { attributes: true, childList: true, subtree: true });
      resize.observe(surface);
    } else if (found && bars.parentElement !== found) {
      found.appendChild(bars);
    }
    schedule();
  };
  const outer = new MutationObserver(attach);
  outer.observe(container, { childList: true, subtree: true });
  attach();

  return () => {
    outer.disconnect();
    watch.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
    bars.remove();
  };
}
