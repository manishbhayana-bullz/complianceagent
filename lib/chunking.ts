/**
 * Simple, dependency-free chunker tuned for regulatory circulars:
 * - Splits on paragraph/clause boundaries first
 * - Falls back to sliding-window word chunks for long paragraphs
 * - Adds overlap so retrieval doesn't lose context across boundaries
 */

export interface ChunkOptions {
  maxWords?: number; // target chunk size
  overlapWords?: number; // overlap between consecutive chunks
}

export function chunkText(
  rawText: string,
  options: ChunkOptions = {}
): string[] {
  const { maxWords = 220, overlapWords = 40 } = options;

  // Normalize whitespace, split into paragraphs / numbered clauses
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferWordCount = 0;

  const flush = () => {
    if (buffer.length > 0) {
      chunks.push(buffer.join('\n\n').trim());
      buffer = [];
      bufferWordCount = 0;
    }
  };

  for (const para of paragraphs) {
    const words = para.split(/\s+/);

    if (words.length > maxWords) {
      // Flush whatever we have, then sliding-window this long paragraph
      flush();
      let start = 0;
      while (start < words.length) {
        const end = Math.min(start + maxWords, words.length);
        chunks.push(words.slice(start, end).join(' '));
        if (end === words.length) break;
        start = end - overlapWords;
      }
      continue;
    }

    if (bufferWordCount + words.length > maxWords) {
      flush();
    }

    buffer.push(para);
    bufferWordCount += words.length;
  }

  flush();
  return chunks.filter((c) => c.length > 0);
}

/** Best-effort extraction of a clause/paragraph reference, e.g. "Para 4.2(a)" */
export function detectClauseRef(chunkText: string): string | undefined {
  const match = chunkText.match(
    /\b(Para(?:graph)?|Clause|Section|Annex(?:ure)?|Regulation)\s+[\dA-Za-z.()]+/i
  );
  return match ? match[0] : undefined;
}
