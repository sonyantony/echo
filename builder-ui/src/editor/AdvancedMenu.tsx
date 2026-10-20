import { DropdownItem } from '@patternfly/react-core';
import { KaotoTabMenu, openKaotoTab } from './KaotoTabMenu';

/** The Advanced menu on the editor's tab line, just before About. Java Beans opens Kaoto's Beans view. */
export function AdvancedMenu() {
  return (
    <KaotoTabMenu label="Advanced" tabTestId="beans-tab" className="echo-advanced-menu">
      <DropdownItem key="beans" onClick={() => openKaotoTab('beans-tab')} description="Define Java beans the flow's steps can use">
        Java Beans
      </DropdownItem>
    </KaotoTabMenu>
  );
}
