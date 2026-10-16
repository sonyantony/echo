/**
 * Saving the flow diagram as a PNG.
 *
 * Kaoto's canvas toolbar has an "export image" button that lays out the whole flow off screen
 * and downloads it as "kaoto-flow.png", on a transparent background with a lot of empty space
 * around it. The Builder hides that button and presses it itself, catches the image before it
 * is saved, and saves a tidier one under the flow's name instead.
 */

const KAOTO_IMAGE_NAME = 'kaoto-flow.png';
const EXPORT_BUTTON = '[data-testid="exportImageButton"]';
/** Space kept around the diagram after trimming, in image pixels (Kaoto renders at 2x). */
const MARGIN = 40;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest box holding every pixel that is not fully transparent, or undefined if none. */
export function opaqueBounds(rgba: ArrayLike<number>, width: number, height: number): Bounds | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Trims Kaoto's image to the diagram plus a margin and puts it on a white background. */
export async function tidyDiagram(png: Blob): Promise<Blob> {
  const image = await createImageBitmap(png);
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext('2d')!;
  sourceContext.drawImage(image, 0, 0);
  const box = opaqueBounds(sourceContext.getImageData(0, 0, image.width, image.height).data, image.width, image.height) ?? {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  };

  const target = document.createElement('canvas');
  target.width = box.width + MARGIN * 2;
  target.height = box.height + MARGIN * 2;
  const context = target.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source, box.x, box.y, box.width, box.height, MARGIN, MARGIN, box.width, box.height);
  return new Promise((resolve, reject) =>
    target.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the image'))), 'image/png'),
  );
}

/**
 * Presses Kaoto's (hidden) export image button inside `container` and returns the PNG it
 * produces, without letting Kaoto save it. Switches Kaoto to its Design tab if another tab is open.
 */
export async function captureKaotoDiagram(container: HTMLElement, timeoutMs = 20_000): Promise<Blob> {
  const button = await findExportButton(container);
  const originalClick = HTMLAnchorElement.prototype.click;
  let restore = () => {};
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => {
      restore();
      reject(new Error('The diagram image was not created in time'));
    }, timeoutMs);
    restore = () => {
      clearTimeout(timer);
      HTMLAnchorElement.prototype.click = originalClick;
    };
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download !== KAOTO_IMAGE_NAME) return originalClick.call(this);
      restore();
      // Kaoto revokes its object URL shortly after the click; read it straight away.
      resolve(fetch(this.href).then((response) => response.blob()));
    };
    button.click();
  });
}

async function findExportButton(container: HTMLElement): Promise<HTMLButtonElement> {
  const find = () => container.querySelector<HTMLButtonElement>(EXPORT_BUTTON);
  if (!find()) window.location.hash = '#/';
  for (let waited = 0; waited < 5_000; waited += 100) {
    const button = find();
    if (button && !button.disabled) return button;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The flow diagram is not available');
}

export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
