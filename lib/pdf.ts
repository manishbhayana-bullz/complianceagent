import pdf from 'pdf-parse';

/**
 * Extracts plain text from a PDF buffer.
 * Note: scanned/image-only PDFs will return little or no text —
 * Phase 2 can add OCR (e.g. Tesseract) for those.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdf(buffer);
  return result.text;
}
