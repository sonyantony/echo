import { Button, DropdownItem } from '@patternfly/react-core';
import { DownloadIcon, ImageIcon } from '@patternfly/react-icons';

export interface DownloadActions {
  /** Downloads the flow as a .zip; undefined when there is no saved flow to download yet. */
  onDownloadZip?(): void;
  /** Downloads the diagram as a PNG; undefined while there is nothing on the canvas. */
  onDownloadImage?(): void;
  /** True while the flow is being saved, or its picture drawn. */
  zipBusy?: boolean;
  imageBusy?: boolean;
}

export interface DownloadMenuItemsProps extends DownloadActions {
  /** The flow's name, shown in the item labels. */
  name: string;
}

/** The Flow Design menu's items: the flow as a .zip of all its files, and its diagram as a PNG. */
export function downloadMenuItems({ name, onDownloadZip, onDownloadImage, zipBusy, imageBusy }: DownloadMenuItemsProps) {
  return [
    <DropdownItem
      key="zip"
      onClick={onDownloadZip}
      isDisabled={!onDownloadZip || zipBusy}
      description={onDownloadZip ? 'All the flow’s files as a .zip you can upload again later' : 'Save the flow first'}
    >
      Download {name}
    </DropdownItem>,
    <DropdownItem
      key="png"
      onClick={onDownloadImage}
      isDisabled={!onDownloadImage || imageBusy}
      description={onDownloadImage ? 'A picture of the whole flow diagram (.png)' : 'Add something to the flow first'}
    >
      Download {name} As Image
    </DropdownItem>,
  ];
}

/** Download Flow (the .zip) and Download Flow As Image (the PNG), on the Flow Design canvas toolbar. */
export function DownloadButtons({ onDownloadZip, onDownloadImage, zipBusy, imageBusy }: DownloadActions) {
  return (
    <>
      <Button
        variant="secondary"
        icon={<DownloadIcon />}
        onClick={onDownloadZip}
        isDisabled={!onDownloadZip || zipBusy}
        title={onDownloadZip ? 'All the flow’s files as a .zip you can upload again later' : 'Save the flow first'}
      >
        Download Flow
      </Button>
      <Button
        variant="secondary"
        icon={<ImageIcon />}
        onClick={onDownloadImage}
        isDisabled={!onDownloadImage || imageBusy}
        title={onDownloadImage ? 'A picture of the whole flow diagram (.png)' : 'Add something to the flow first'}
      >
        Download Flow As Image
      </Button>
    </>
  );
}
