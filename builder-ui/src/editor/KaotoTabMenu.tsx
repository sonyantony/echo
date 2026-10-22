import { Dropdown, DropdownList, MenuToggle } from '@patternfly/react-core';
import { useEffect, useState, type ReactNode } from 'react';
import { useDismissMenu } from './menuDismiss';

const tabButton = (testId: string) =>
  document.querySelector<HTMLElement>(`.echo-kaoto-host [data-testid='${testId}'] [role='tab']`);

/** Presses one of Kaoto's tabs (hidden or not), so Kaoto's own router opens its view. */
export function openKaotoTab(testId: string) {
  document.querySelector<HTMLElement>(`.echo-kaoto-host [data-testid='${testId}']`)?.click();
}

/**
 * Whether Kaoto's tab with this test id is the open one, kept up to date as the user moves between
 * tabs. `whenMissing` is the answer before Kaoto has drawn its tabs.
 */
export function useKaotoTabSelected(testId: string, whenMissing = false) {
  const [selected, setSelected] = useState(whenMissing);
  useEffect(() => {
    const update = () => {
      const tab = tabButton(testId);
      setSelected(tab ? tab.getAttribute('aria-selected') === 'true' : whenMissing);
    };
    const host = document.querySelector('.echo-kaoto-host');
    if (!host) return;
    const observer = new MutationObserver(update);
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
    update();
    return () => observer.disconnect();
  }, [testId, whenMissing]);
  return selected;
}

export interface KaotoTabMenuProps {
  label: string;
  /** Kaoto's tab this menu stands in for: it shows as current, with the tab underline, while that view is open (tabUnderline.ts). */
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
  useDismissMenu(open, setOpen);
  const current = useKaotoTabSelected(tabTestId);

  return (
    <div className="echo-tab-actions echo-no-print">
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
            data-echo-tab={tabTestId}
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
