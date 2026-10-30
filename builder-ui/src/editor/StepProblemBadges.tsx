import { List, ListItem, Popover } from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import type { ValidationProblem } from '../api/flows';
import { stepNode } from './stepProblems';

const BADGE_CLASS = 'echo-step-problem';

/** Where a node's badge goes: the top-right of a step's icon, or the end of an open container's title bar. */
function badgeHost(node: Element): Element | undefined {
  // A container's node holds its steps' nodes: take the host that is the node's own.
  return [...node.querySelectorAll('.custom-node__container__image, .custom-group__container__text')].find(
    (el) => el.closest('g[data-id]') === node,
  );
}

/** "2 problems" */
export const problemCount = (n: number) => `${n} problem${n === 1 ? '' : 's'}`;

/** Where a problem is: the route file's line, or the file it is in. */
export const problemPlace = (p: ValidationProblem) => `${p.file}${p.line ? `:${p.line}` : ''}`;

/**
 * A red circle at the top right of each canvas step with validation problems, counting them; clicking
 * it opens a box with the step's problems. Kaoto draws the canvas, so the circles are added to its
 * nodes (again whenever it redraws them) and the box is anchored to the circle clicked.
 */
export function StepProblemBadges({ container, problems }: { container: HTMLElement; problems: Map<string, ValidationProblem[]> }) {
  const [open, setOpen] = useState<{ badge: HTMLElement; problems: ValidationProblem[]; step: string }>();
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const badges = new Map<string, HTMLButtonElement>();
    const update = () => {
      // Problems by the node shown for them: the step itself, or the closed container holding it.
      const shown = new Map<string, { host: Element; problems: ValidationProblem[] }>();
      for (const [step, list] of problems) {
        const found = stepNode(container, step, badgeHost);
        if (found) shown.set(found.node, { host: found.host, problems: [...(shown.get(found.node)?.problems ?? []), ...list] });
      }
      for (const [node, badge] of badges) {
        if (!shown.has(node) || !badge.isConnected) {
          badge.remove();
          badges.delete(node);
        }
      }
      for (const [node, { host, problems: list }] of shown) {
        let badge = badges.get(node);
        if (!badge) {
          badge = document.createElement('button');
          badge.type = 'button';
          badge.className = BADGE_CLASS;
          // Kaoto selects (and drags) a step on a press anywhere on it: the circle only opens its box.
          for (const type of ['pointerdown', 'mousedown', 'dblclick', 'contextmenu'] as const) {
            badge.addEventListener(type, (event) => event.stopPropagation());
          }
          badges.set(node, badge);
        }
        if (badge.parentElement !== host) host.append(badge);
        const label = host.closest('[data-nodelabel]')?.getAttribute('data-nodelabel') ?? '';
        // Only real changes: the observer sees the badge's own text change.
        if (badge.textContent !== String(list.length)) badge.textContent = String(list.length);
        badge.dataset.step = node;
        badge.setAttribute('aria-label', `${problemCount(list.length)} on ${label || 'this step'}`);
        badge.title = `${problemCount(list.length)}: click to see ${list.length === 1 ? 'it' : 'them'}`;
        badge.onclick = (event) => {
          event.stopPropagation();
          const target = event.currentTarget as HTMLElement;
          setOpen(openRef.current?.badge === target ? undefined : { badge: target, problems: list, step: label });
        };
      }
      if (openRef.current && !openRef.current.badge.isConnected) setOpen(undefined);
    };
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true });
    update();
    return () => {
      observer.disconnect();
      badges.forEach((badge) => badge.remove());
      setOpen(undefined);
    };
  }, [container, problems]);

  if (!open) return null;
  return (
    <Popover
      triggerRef={() => open.badge}
      isVisible
      shouldClose={() => setOpen(undefined)}
      position="right"
      minWidth="20rem"
      maxWidth="32rem"
      headerContent={`${problemCount(open.problems.length)}${open.step ? ` on ${open.step}` : ''}`}
      headerIcon={null}
      alertSeverityVariant="danger"
      bodyContent={
        <List data-testid="step-problems">
          {open.problems.map((p, i) => (
            <ListItem key={i}>
              {p.message} <span className="echo-step-problem__place">({problemPlace(p)})</span>
            </ListItem>
          ))}
        </List>
      }
      aria-label="Problems on this step"
    />
  );
}
