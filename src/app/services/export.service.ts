import { Injectable } from '@angular/core';

const POINTS_PER_MILLIMETER = 72 / 25.4;
const EXPORT_PIXELS_PER_MILLIMETER = 8;
const JPEG_QUALITY = 0.95;

@Injectable({ providedIn: 'root' })
export class ExportService {
  serializeSvg(svg: SVGSVGElement): string {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-editor-helper="true"]').forEach((node) => node.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }

  async downloadPdfFromSvg(
    filename: string,
    svg: SVGSVGElement,
    widthMillimeters: number,
    heightMillimeters: number,
  ): Promise<void> {
    const jpegBytes = await this.renderSvgToJpeg(svg, widthMillimeters, heightMillimeters);
    this.downloadBlob(
      filename,
      this.createSingleImagePdf(jpegBytes, widthMillimeters, heightMillimeters),
    );
  }

  downloadText(filename: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    this.downloadBlob(filename, blob);
  }

  private async renderSvgToJpeg(
    svg: SVGSVGElement,
    widthMillimeters: number,
    heightMillimeters: number,
  ): Promise<Uint8Array> {
    const svgBlob = new Blob([this.serializeSvg(svg)], { type: 'image/svg+xml' });
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
      return this.dataUrlToBytes(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
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

  private createSingleImagePdf(
    jpegBytes: Uint8Array,
    widthMillimeters: number,
    heightMillimeters: number,
  ): Blob {
    const encoder = new TextEncoder();
    const pageWidth = this.formatPdfNumber(widthMillimeters * POINTS_PER_MILLIMETER);
    const pageHeight = this.formatPdfNumber(heightMillimeters * POINTS_PER_MILLIMETER);
    const imageWidth = Math.ceil(widthMillimeters * EXPORT_PIXELS_PER_MILLIMETER);
    const imageHeight = Math.ceil(heightMillimeters * EXPORT_PIXELS_PER_MILLIMETER);
    const contentStream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
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
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    );
    offsets[4] = byteOffset;
    push('4 0 obj\n');
    push(
      `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    );
    push(jpegBytes);
    push('\nendstream\nendobj\n');
    object(5, `<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}endstream`);

    const xrefOffset = byteOffset;
    push('xref\n0 6\n');
    push('0000000000 65535 f \n');
    for (let id = 1; id <= 5; id += 1) {
      push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const [, base64] = dataUrl.split(',');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
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
