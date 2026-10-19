import { Dropdown, DropdownItem, DropdownList, MenuToggle } from '@patternfly/react-core';
import { useEffect, useState } from 'react';

/** Kaoto's route for its Beans view (its router keeps routes in the URL hash). */
const BEANS_HASH = '#/beans';

/**
 * The Advanced menu on the editor's tab line, just before About. Its Java Beans item opens Kaoto's
 * Beans view, whose own tab is hidden (KaotoEditorHost.css): the item presses that hidden tab, so
 * Kaoto's router does the navigating.
 */
export function AdvancedMenu() {
  const [open, setOpen] = useState(false);
  const [onBeans, setOnBeans] = useState(window.location.hash === BEANS_HASH);

  useEffect(() => {
    const update = () => setOnBeans(window.location.hash === BEANS_HASH);
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  const openBeans = () => {
    document.querySelector<HTMLElement>(".echo-kaoto-host [data-testid='beans-tab']")?.click();
    setOnBeans(true);
  };

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
            className={onBeans ? 'echo-advanced-menu echo-advanced-menu--current' : 'echo-advanced-menu'}
            isExpanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            Advanced
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem key="beans" onClick={openBeans} description="Define Java beans the flow's steps can use">
            Java Beans
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );
}
