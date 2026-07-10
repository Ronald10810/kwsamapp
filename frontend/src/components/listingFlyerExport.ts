import { toJpeg, toPng } from 'html-to-image';
import jsPDF from 'jspdf';

type RasterFormat = 'png' | 'jpg';
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

type RasterExportDimensions = {
  width: number;
  height: number;
  backgroundColor?: string;
};

async function waitForImages(node: HTMLElement): Promise<void> {
  const images = Array.from(node.querySelectorAll('img'));
  if (images.length === 0) return;

  await Promise.all(images.map(async (img) => {
    if (img.complete) return;
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        img.removeEventListener('load', onDone);
        img.removeEventListener('error', onDone);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };

      img.addEventListener('load', onDone, { once: true });
      img.addEventListener('error', onDone, { once: true });
      window.setTimeout(onDone, 3500);
    });
  }));
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}

function createExportNode(node: HTMLElement): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.width = `${A4_WIDTH_PX}px`;
  clone.style.minWidth = `${A4_WIDTH_PX}px`;
  clone.style.maxWidth = `${A4_WIDTH_PX}px`;
  clone.style.height = `${A4_HEIGHT_PX}px`;
  clone.style.minHeight = `${A4_HEIGHT_PX}px`;
  clone.style.maxHeight = `${A4_HEIGHT_PX}px`;
  clone.style.margin = '0';
  clone.style.borderRadius = '0';
  clone.style.boxShadow = 'none';
  clone.style.overflow = 'hidden';

  const mount = document.createElement('div');
  mount.style.position = 'fixed';
  mount.style.left = '-10000px';
  mount.style.top = '0';
  mount.style.width = `${A4_WIDTH_PX}px`;
  mount.style.height = `${A4_HEIGHT_PX}px`;
  mount.style.overflow = 'hidden';
  mount.style.background = '#ffffff';
  mount.appendChild(clone);
  document.body.appendChild(mount);

  return mount;
}

function getRenderOptions() {
  return {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    width: A4_WIDTH_PX,
    height: A4_HEIGHT_PX,
    canvasWidth: A4_WIDTH_PX * 2,
    canvasHeight: A4_HEIGHT_PX * 2,
  };
}

export async function downloadNodeAsRasterImage(node: HTMLElement, fileName: string, format: RasterFormat): Promise<void> {
  const exportMount = createExportNode(node);
  const exportNode = exportMount.firstElementChild as HTMLElement;
  try {
    await waitForImages(exportNode);
    const renderOptions = getRenderOptions();
    const dataUrl = format === 'png'
      ? await toPng(exportNode, renderOptions)
      : await toJpeg(exportNode, { ...renderOptions, quality: 0.96 });

    downloadDataUrl(dataUrl, `${fileName}.${format}`);
  } finally {
    exportMount.remove();
  }
}

export async function downloadNodeAsPdf(node: HTMLElement, fileName: string): Promise<void> {
  const exportMount = createExportNode(node);
  const exportNode = exportMount.firstElementChild as HTMLElement;
  try {
    await waitForImages(exportNode);
    const renderOptions = getRenderOptions();
    const imageDataUrl = await toJpeg(exportNode, { ...renderOptions, quality: 0.98 });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    pdf.addImage(imageDataUrl, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    pdf.save(`${fileName}.pdf`);
  } finally {
    exportMount.remove();
  }
}

function createExportNodeWithDimensions(node: HTMLElement, dimensions: RasterExportDimensions): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.width = `${dimensions.width}px`;
  clone.style.minWidth = `${dimensions.width}px`;
  clone.style.maxWidth = `${dimensions.width}px`;
  clone.style.height = `${dimensions.height}px`;
  clone.style.minHeight = `${dimensions.height}px`;
  clone.style.maxHeight = `${dimensions.height}px`;
  clone.style.margin = '0';
  clone.style.borderRadius = '0';
  clone.style.boxShadow = 'none';
  clone.style.overflow = 'hidden';

  const mount = document.createElement('div');
  mount.style.position = 'fixed';
  mount.style.left = '-10000px';
  mount.style.top = '0';
  mount.style.width = `${dimensions.width}px`;
  mount.style.height = `${dimensions.height}px`;
  mount.style.overflow = 'hidden';
  mount.style.background = dimensions.backgroundColor ?? '#ffffff';
  mount.appendChild(clone);
  document.body.appendChild(mount);

  return mount;
}

function getRenderOptionsWithDimensions(dimensions: RasterExportDimensions) {
  return {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: dimensions.backgroundColor ?? '#ffffff',
    width: dimensions.width,
    height: dimensions.height,
    canvasWidth: dimensions.width * 2,
    canvasHeight: dimensions.height * 2,
  };
}

export async function downloadNodeAsRasterImageWithDimensions(
  node: HTMLElement,
  fileName: string,
  format: RasterFormat,
  dimensions: RasterExportDimensions,
): Promise<void> {
  const exportMount = createExportNodeWithDimensions(node, dimensions);
  const exportNode = exportMount.firstElementChild as HTMLElement;
  try {
    await waitForImages(exportNode);
    const renderOptions = getRenderOptionsWithDimensions(dimensions);
    const dataUrl = format === 'png'
      ? await toPng(exportNode, renderOptions)
      : await toJpeg(exportNode, { ...renderOptions, quality: 0.96 });

    downloadDataUrl(dataUrl, `${fileName}.${format}`);
  } finally {
    exportMount.remove();
  }
}

export async function renderNodeAsRasterImageBlob(
  node: HTMLElement,
  format: RasterFormat,
  dimensions: RasterExportDimensions,
): Promise<Blob> {
  const exportMount = createExportNodeWithDimensions(node, dimensions);
  const exportNode = exportMount.firstElementChild as HTMLElement;
  try {
    await waitForImages(exportNode);
    const renderOptions = getRenderOptionsWithDimensions(dimensions);
    const dataUrl = format === 'png'
      ? await toPng(exportNode, renderOptions)
      : await toJpeg(exportNode, { ...renderOptions, quality: 0.96 });

    const res = await fetch(dataUrl);
    return await res.blob();
  } finally {
    exportMount.remove();
  }
}