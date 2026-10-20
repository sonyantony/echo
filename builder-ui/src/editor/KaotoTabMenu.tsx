import { Dropdown, DropdownList, MenuToggle } from '@patternfly/react-core';
import { useEffect, useState, type ReactNode } from 'react';

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
