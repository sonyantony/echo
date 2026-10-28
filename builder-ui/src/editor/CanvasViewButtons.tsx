import { Button, Tooltip } from '@patternfly/react-core';
import { ObjectGroupIcon, WindowMaximizeIcon, WindowRestoreIcon } from '@patternfly/react-icons';

/*
 * ECHO's buttons on Kaoto's canvas control bar (bottom left), after its Reset View, made like
 * Kaoto's own (PatternFly topology's control bar buttons): Fit Route zooms the route in to fill
 * the canvas, Maximize gives the canvas the whole window.
 */

/** `routeSelected`: a route is selected on the canvas, so Fit Route fits that one, otherwise the whole flow. */
export function FitRouteButton({ routeSelected, onClick }: { routeSelected: boolean; onClick(): void }) {
  const tip = routeSelected
    ? 'Fit Route: enlarge the selected route to fill the canvas'
    : 'Fit Route: enlarge the flow to fill the canvas (select a route to fit only that one)';
  return (
    <Tooltip content={tip}>
      <Button id="echo-fit-route" className="pf-topology-control-bar__button" variant="tertiary" onClick={onClick}>
        <ObjectGroupIcon />
        <span className="pf-v6-screen-reader">Fit Route</span>
      </Button>
    </Tooltip>
  );
}

export function MaximizeCanvasButton({ maximized, onClick }: { maximized: boolean; onClick(): void }) {
  return (
    <Tooltip content={maximized ? 'Restore (Esc)' : 'Maximize: the canvas fills the window'}>
      <Button id="echo-maximize-canvas" className="pf-topology-control-bar__button" variant="tertiary" aria-pressed={maximized} onClick={onClick}>
        {maximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        <span className="pf-v6-screen-reader">{maximized ? 'Restore Canvas' : 'Maximize Canvas'}</span>
      </Button>
    </Tooltip>
  );
}
