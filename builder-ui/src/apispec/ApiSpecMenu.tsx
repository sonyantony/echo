import { Dropdown, DropdownItem, DropdownList, MenuToggle } from '@patternfly/react-core';
import { CodeIcon, CopyIcon, DownloadIcon, UploadIcon } from '@patternfly/react-icons';
import { useState, type RefObject } from 'react';
import { useDismissMenu } from '../editor/menuDismiss';
import { UNDERLINED_CLASS } from '../editor/tabUnderline';
import type { ApiSpecPanelHandle } from './ApiSpecPanel';

interface Props {
  /** Openapi Design's view is open: its item has the tab line's underline. */
  current: boolean;
  /** Opens Openapi Design's view (clicking the item does, as well as opening the menu). */
  onShow(): void;
  panel: RefObject<ApiSpecPanelHandle | null>;
  onCopy(): void;
}

/**
 * Openapi Design, on the tab line right after File: API-first flows start from the spec, then
 * Flow Design. The spec is also the flow's REST service: ECHO makes it from the spec (no Rest tab).
 * Like Flow Design it opens its view (the flow's OpenAPI spec, in place of Kaoto's views) and a menu.
 */
export function ApiSpecMenu({ current, onShow, panel, onCopy }: Props) {
  const [open, setOpen] = useState(false);
  useDismissMenu(open, setOpen);
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
            // The underline class is React's too, or opening the menu (a re-render) would drop it.
            className={`echo-tab-menu echo-api-spec-tab${current ? ` ${UNDERLINED_CLASS}` : ''}`}
            data-echo-tab-current={current ? '' : undefined}
            aria-current={current ? 'page' : undefined}
            isExpanded={open}
            onClick={() => {
              onShow();
              setOpen((was) => !was);
            }}
          >
            Openapi Design
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem
            key="upload"
            icon={<UploadIcon />}
            onClick={() => panel.current?.upload()}
            description="Store a .yaml or .json OpenAPI file in this flow, under its own name"
          >
            Upload
          </DropdownItem>
          <DropdownItem
            key="copy"
            icon={<CopyIcon />}
            onClick={onCopy}
            description="Start this flow's spec from a copy of another flow's"
          >
            Copy From Another Flow
          </DropdownItem>
          <DropdownItem
            key="samples"
            icon={<CodeIcon />}
            onClick={() => panel.current?.newFromSamples()}
            description="Make the spec from a sample request and response"
          >
            New From Samples
          </DropdownItem>
          <DropdownItem
            key="yaml"
            icon={<DownloadIcon />}
            onClick={() => panel.current?.download('yaml')}
            description="The spec on screen, unsaved edits included"
          >
            Download Openapi File As Yaml
          </DropdownItem>
          <DropdownItem
            key="json"
            icon={<DownloadIcon />}
            onClick={() => panel.current?.download('json')}
            description="The spec on screen, unsaved edits included"
          >
            Download Openapi File As Json
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );
}
