import { Dropdown, DropdownItem, DropdownList, MenuToggle, MenuToggleAction } from '@patternfly/react-core';
import { DownloadIcon } from '@patternfly/react-icons';
import { useState } from 'react';

export interface DownloadFlowMenuProps {
  /** The flow's name, shown in the item labels. */
  name: string;
  /** Downloads the flow as a .zip; undefined when there is no saved flow to download yet. */
  onDownloadZip?(): void;
  onDownloadImage(): void;
  /** True while the flow is being saved, or its picture drawn. */
  zipBusy?: boolean;
  imageBusy?: boolean;
}

/**
 * Download Flow on the Flow Design canvas toolbar, where Kaoto's copy to clipboard was. Pressing it
 * downloads the flow as a .zip (every file of the flow); its menu also offers the diagram as a PNG.
 */
export function DownloadFlowMenu({ name, onDownloadZip, onDownloadImage, zipBusy, imageBusy }: DownloadFlowMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      isOpen={open}
      onOpenChange={setOpen}
      onSelect={() => setOpen(false)}
      popperProps={{ position: 'start', appendTo: () => document.body }}
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          variant="secondary"
          className="echo-download-flow"
          isExpanded={open}
          onClick={() => setOpen((o) => !o)}
          aria-label="Download options"
          splitButtonItems={[
            <MenuToggleAction
              key="zip"
              onClick={onDownloadZip}
              isDisabled={!onDownloadZip || zipBusy}
            >
              <DownloadIcon /> Download Flow
            </MenuToggleAction>,
          ]}
        />
      )}
    >
      <DropdownList>
        <DropdownItem
          key="zip"
          onClick={onDownloadZip}
          isDisabled={!onDownloadZip || zipBusy}
          description={onDownloadZip ? 'All the flow’s files as a .zip you can upload again later' : 'Save the flow first'}
        >
          Download {name}
        </DropdownItem>
        <DropdownItem key="png" onClick={onDownloadImage} isDisabled={imageBusy} description="A picture of the whole flow diagram (.png)">
          Download {name} As Image
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
}
