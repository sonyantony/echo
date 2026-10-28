import { Divider, Dropdown, DropdownItem, DropdownList, MenuToggle } from '@patternfly/react-core';
import { CodeIcon, CopyIcon, DownloadIcon, UploadIcon } from '@patternfly/react-icons';
import { useState, type RefObject } from 'react';
import { useDismissMenu } from '../editor/menuDismiss';
import { UNDERLINED_CLASS } from '../editor/tabUnderline';
import type { ApiSpecPanelHandle } from './ApiSpecPanel';

interface Props {
  /** Interface's view is open: its item has the tab line's underline. */
  current: boolean;
  /** Makes the spec's editor ready, out of sight, so the menu's items have it to work on. */
  onOpen(): void;
  /** Opens Interface's view: Design, and the items whose result is seen there. */
  onShow(): void;
  panel: RefObject<ApiSpecPanelHandle | null>;
  onCopy(): void;
}

/**
 * Interface (the flow's Openapi spec), on the tab line right after File: API-first flows start from the spec, then
 * Flow. The spec is also the flow's REST service: ECHO makes it from the spec (no Rest tab).
 * Like Flow, clicking it only opens its menu; Design opens its view (the flow's OpenAPI spec, in place of
 * Kaoto's views) at the spec's overview.
 */
export function ApiSpecMenu({ current, onOpen, onShow, panel, onCopy }: Props) {
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
              onOpen();
              setOpen((was) => !was);
            }}
          >
            Interface Specs
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem
            key="design"
            onClick={() => {
              onShow();
              panel.current?.showOverview();
            }}
            description="The flow's OpenAPI spec: paths, data types and responses"
          >
            Design
          </DropdownItem>
          <DropdownItem
            key="upload"
            icon={<UploadIcon />}
            onClick={() => {
              onShow();
              panel.current?.upload();
            }}
            description="Store a .yaml or .json OpenAPI file in this flow, under its own name"
          >
            Upload
          </DropdownItem>
          <DropdownItem
            key="copy"
            icon={<CopyIcon />}
            onClick={() => {
              onShow();
              onCopy();
            }}
            description="Start this flow's spec from a copy of another flow's"
          >
            Copy From Another Flow
          </DropdownItem>
          <DropdownItem
            key="samples"
            icon={<CodeIcon />}
            onClick={() => {
              onShow();
              panel.current?.newFromSamples();
            }}
            description="Make the spec from a sample request and response"
          >
            New Interface Specs from Samples
          </DropdownItem>
          <Divider component="li" key="download-divider" />
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
