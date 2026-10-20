import { Dropdown, DropdownList, MenuToggle } from '@patternfly/react-core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const tabButton = (testId: string) =>
  document.querySelector<HTMLElement>(`.echo-kaoto-host [data-testid='${testId}'] [role='tab']`);

/** Presses one of Kaoto's tabs (hidden or not), so Kaoto's own router opens its view. */
export function openKaotoTab(testId: string) {
  document.querySelector<HTMLElement>(`.echo-kaoto-host [data-testid='${testId}']`)?.click();
}

/** Whether Kaoto's tab with this test id is the open one, kept up to date as the user moves between tabs. */
function useKaotoTabSelected(testId: string) {
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    const update = () => setSelected(tabButton(testId)?.getAttribute('aria-selected') === 'true');
    const host = document.querySelector('.echo-kaoto-host');
    if (!host) return;
    const observer = new MutationObserver(update);
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
    update();
    return () => observer.disconnect();
  }, [testId]);
  return selected;
}

const ACCENT_PROPERTIES = [
  '--pf-v6-c-tabs--link-accent--start',
  '--pf-v6-c-tabs--link-accent--TranslateX',
  '--pf-v6-c-tabs--link-accent--length',
];

/**
 * While a menu's view is open, moves Kaoto's tab underline (PatternFly's animated accent, drawn by the
 * tab list) under the menu, so it looks exactly like a tab's. PatternFly sets the accent's position on
 * the tabs element; these values on the list itself take precedence, and are removed again once
 * another tab is open.
 */
function useTabAccent(wrapper: React.RefObject<HTMLElement | null>, current: boolean, label: string) {
  useLayoutEffect(() => {
    const item = wrapper.current?.closest('li');
    const list = item?.parentElement;
    if (!item || !list) return;
    if (!current) {
      if (list.dataset.echoAccent === label) {
        for (const name of ACCENT_PROPERTIES) list.style.removeProperty(name);
        delete list.dataset.echoAccent;
      }
      return;
    }
    const place = () => {
      const toggle = wrapper.current?.querySelector('.pf-v6-c-menu-toggle') ?? item;
      const box = toggle.getBoundingClientRect();
      const start = box.left - list.getBoundingClientRect().left + list.scrollLeft;
      list.style.setProperty('--pf-v6-c-tabs--link-accent--start', `${start}px`);
      // PatternFly derives TranslateX from start on the tabs element, so it is set here too.
      list.style.setProperty('--pf-v6-c-tabs--link-accent--TranslateX', `${start}px`);
      list.style.setProperty('--pf-v6-c-tabs--link-accent--length', `${box.width}px`);
      list.dataset.echoAccent = label;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [wrapper, current, label]);
}

export interface KaotoTabMenuProps {
  label: string;
  /** Kaoto's tab this menu stands in for: it shows as current while that view is open. */
  tabTestId: string;
  /** Opens that view too when the menu is opened (Flow Design); otherwise only an item does (Advanced). */
  opensTab?: boolean;
  className: string;
  children?: ReactNode;
}

/**
 * A menu on the editor's tab line, in place of one or more of Kaoto's tabs (hidden in
 * KaotoEditorHost.css). Its items press those hidden tabs, so Kaoto's router does the navigating.
 */
export function KaotoTabMenu({ label, tabTestId, opensTab, className, children }: KaotoTabMenuProps) {
  const [open, setOpen] = useState(false);
  const current = useKaotoTabSelected(tabTestId);
  const wrapper = useRef<HTMLDivElement>(null);
  useTabAccent(wrapper, current, label);

  return (
    <div ref={wrapper} className="echo-tab-actions echo-no-print">
      <Dropdown
        isOpen={open}
        onOpenChange={setOpen}
        onSelect={() => setOpen(false)}
        popperProps={{ position: 'start', appendTo: () => document.body }}
        toggle={(toggleRef) => (
          <MenuToggle
            ref={toggleRef}
            variant="plainText"
            className={`echo-tab-menu ${className}${current ? ' echo-tab-menu--current' : ''}`}
            isExpanded={open}
            onClick={() => {
              if (opensTab) openKaotoTab(tabTestId);
              if (children) setOpen((o) => !o);
            }}
          >
            {label}
          </MenuToggle>
        )}
      >
        <DropdownList>{children}</DropdownList>
      </Dropdown>
    </div>
  );
}
