import { Injectable } from '@angular/core';

const POINTS_PER_MILLIMETER = 72 / 25.4;
const EXPORT_PIXELS_PER_MILLIMETER = 8;

type PdfImagePage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

export class ExportImageAccessError extends Error {
  constructor(readonly imageUrl: string) {
    super(
      `Unable to export image URL because the image host does not allow browser access: ${imageUrl}`,
    );
  }
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  async serializeSvg(svg: SVGSVGElement, layerId?: string): Promise<string> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone
      .querySelectorAll('[data-editor-helper="true"], [data-interaction-guides="true"]')
      .forEach((node) => node.remove());
    if (layerId) {
      clone
        .querySelectorAll(`[data-export-layer-id]:not([data-export-layer-id="${CSS.escape(layerId)}"])`)
        .forEach((node) => node.remove());
    }
    await this.embedLinkedImages(clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }

  async downloadPdfFromSvg(
    filename: string,
    svg: SVGSVGElement,
    widthMillimeters: number,
    heightMillimeters: number,
    layerIds: string[] = [],
  ): Promise<void> {
    const exportLayerIds = layerIds.length > 0 ? layerIds : [undefined];
    const pages = await Promise.all(
      exportLayerIds.map((layerId) =>
        this.renderSvgToRgb(svg, widthMillimeters, heightMillimeters, layerId),
      ),
    );
    this.downloadBlob(
      filename,
      this.createImagePdf(pages, widthMillimeters, heightMillimeters),
    );
  }

  downloadText(filename: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    this.downloadBlob(filename, blob);
  }

  private async renderSvgToRgb(
    svg: SVGSVGElement,
    widthMillimeters: number,
    heightMillimeters: number,
    layerId?: string,
  ): Promise<PdfImagePage> {
    const svgBlob = new Blob([await this.serializeSvg(svg, layerId)], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const image = await this.loadImage(svgUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(widthMillimeters * EXPORT_PIXELS_PER_MILLIMETER);
      canvas.height = Math.ceil(heightMillimeters * EXPORT_PIXELS_PER_MILLIMETER);

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to create PDF export canvas.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return {
        bytes: this.canvasRgbBytes(context, canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height,
      };
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to render SVG for PDF export.'));
      image.src = url;
    });
  }

  private async embedLinkedImages(svg: SVGSVGElement): Promise<void> {
    const images = Array.from(svg.querySelectorAll('image'));
    await Promise.all(
      images.map(async (image) => {
        const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
        if (!href || href.startsWith('data:')) {
          return;
        }

        const dataUrl = await this.fetchAsDataUrl(href);
        image.setAttribute('href', dataUrl);
        image.removeAttribute('xlink:href');
      }),
    );
  }

  private async fetchAsDataUrl(url: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, { credentials: 'omit' });
    } catch {
      throw new ExportImageAccessError(url);
    }
    if (!response.ok) {
      throw new ExportImageAccessError(url);
    }
    return this.blobToDataUrl(await response.blob());
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Unable to embed export image.'));
      reader.readAsDataURL(blob);
    });
  }

  private createImagePdf(
    pages: PdfImagePage[],
    widthMillimeters: number,
    heightMillimeters: number,
  ): Blob {
    const encoder = new TextEncoder();
    const pageWidth = this.formatPdfNumber(widthMillimeters * POINTS_PER_MILLIMETER);
    const pageHeight = this.formatPdfNumber(heightMillimeters * POINTS_PER_MILLIMETER);
    const contentStream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
    const pageObjectIds = pages.map((_, index) => 3 + index);
    const firstResourceObjectId = 3 + pages.length;
    const chunks: BlobPart[] = [];
    const offsets: number[] = [0];
    let byteOffset = 0;

    const push = (content: string | Uint8Array): void => {
      const bytes = typeof content === 'string' ? encoder.encode(content) : content;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      chunks.push(buffer);
      byteOffset += bytes.length;
    };
    const object = (id: number, content: string | Uint8Array): void => {
      offsets[id] = byteOffset;
      push(`${id} 0 obj\n`);
      push(content);
      push('\nendobj\n');
    };

    push('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(
      2,
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    );
    pages.forEach((_, index) => {
      const pageObjectId = pageObjectIds[index];
      const imageObjectId = firstResourceObjectId + index * 2;
      const contentObjectId = imageObjectId + 1;
      object(
        pageObjectId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      );
    });
    pages.forEach((page, index) => {
      const imageObjectId = firstResourceObjectId + index * 2;
      const contentObjectId = imageObjectId + 1;
      offsets[imageObjectId] = byteOffset;
      push(`${imageObjectId} 0 obj\n`);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${page.bytes.length} >>\nstream\n`,
      );
      push(page.bytes);
      push('\nendstream\nendobj\n');
      object(
        contentObjectId,
        `<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}endstream`,
      );
    });

    const xrefOffset = byteOffset;
    const objectCount = firstResourceObjectId + pages.length * 2;
    push(`xref\n0 ${objectCount}\n`);
    push('0000000000 65535 f \n');
    for (let id = 1; id < objectCount; id += 1) {
      push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  private canvasRgbBytes(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): Uint8Array {
    const rgba = context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
      rgb[targetIndex] = rgba[sourceIndex];
      rgb[targetIndex + 1] = rgba[sourceIndex + 1];
      rgb[targetIndex + 2] = rgba[sourceIndex + 2];
      targetIndex += 3;
    }
    return rgb;
  }

  private formatPdfNumber(value: number): string {
    return value.toFixed(3).replace(/\.?0+$/, '');
  }

  private downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
