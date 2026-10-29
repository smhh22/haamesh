/**
 * Build a minimal N-page PDF with title/author metadata in memory.
 * Hand-written objects and xref keep the fixture dependency-free.
 */
export const createTestPdf = (pages = 1): Uint8Array<ArrayBuffer> => {
  if (pages < 1) throw new RangeError('pages must be >= 1');
  const firstPageObject = 3;
  const pageObjectIds = Array.from({ length: pages }, (_, index) => firstPageObject + index * 2);
  const fontObjectId = firstPageObject + pages * 2;
  const infoObjectId = fontObjectId + 1;

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
  ];
  pageObjectIds.forEach((id, index) => {
    const content = `BT /F1 24 Tf 72 720 Td (Hamesh PDF Test - page ${index + 1}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Title (Hamesh PDF Test) /Author (Test Author) >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjectId} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new TextEncoder().encode(pdf);
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
};
