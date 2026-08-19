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

const CLAUSE_REF_PATTERN =
  /\b(Para(?:graph)?|Clause|Section|Annex(?:ure)?|Regulation)\s+[\dA-Za-z.()]+/i;

/** Best-effort extraction of a clause/paragraph reference, e.g. "Para 4.2(a)".
 *  Prefers refs that head a paragraph (the clause the paragraph is actually
 *  about) over refs buried mid-sentence (usually incidental cross-references
 *  to other sections). Falls back to the first match anywhere if no
 *  paragraph-heading ref is found. */
export function detectClauseRef(chunkText: string): string | undefined {
  const paragraphs = chunkText.split(/\n\n+/);

  for (const para of paragraphs) {
    const trimmed = para.trimStart();
    const headingMatch = trimmed.match(CLAUSE_REF_PATTERN);
    // Only count it as a "heading" ref if it appears in the first ~15 chars
    // of the paragraph — i.e. it's basically the first thing in the para,
    // not a reference that shows up after several sentences of prose.
    if (headingMatch && headingMatch.index !== undefined && headingMatch.index <= 15) {
      return headingMatch[0];
    }
  }

  // No paragraph-heading-style ref found — fall back to old behavior
  // (first match anywhere) rather than returning nothing.
  const fallback = chunkText.match(CLAUSE_REF_PATTERN);
  return fallback ? fallback[0] : undefined;
}
