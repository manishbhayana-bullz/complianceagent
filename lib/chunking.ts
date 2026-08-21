/**
 * Chunker tuned for Indian regulatory circulars, which nest provisions in a
 * nearly-universal pattern:
 *   126C.  <top-level clause, "N" or "NA"/"NB" or "N(M)" style>
 *     (iii) <roman-numeral sub-clause>
 *       (a)  <lettered sub-sub-clause>
 * Cross-references to OTHER documents/regulations (e.g. "Section 45L of the
 * RBI Act", "regulation 14 of the SEBI (InvIT) Regulations") appear
 * mid-sentence, never at the start of a paragraph — so anchoring detection
 * to paragraph-start position naturally excludes them without needing a
 * keyword list.
 *
 * Each detected clause marker forces a chunk boundary. This trades chunk
 * count (more, smaller chunks) for citation precision (every chunk's
 * clause_ref is exactly the provision it contains, never a coarser parent
 * label borrowed from whichever paragraph happened to start the buffer).
 */

export interface ChunkOptions {
  maxWords?: number; // target chunk size for un-marked prose runs
  overlapWords?: number; // overlap for the long-paragraph sliding-window fallback
}

export interface Chunk {
  text: string;
  clauseRef?: string;
}

const TOP_DOT_RE = /^(\d{1,3}[A-Z]?)\.\s/; // "126A. ", "126C. ", "2. ", "4. "
const TOP_PAREN_RE = /^(\d+)\((\d+)\)/; // "3(1)", "3(2)"
const SUB_ROMAN_RE = /^\((x{0,3})(ix|iv|v?i{0,3})\)\s/i; // "(i)" .. "(xiii)"
const SUB_LETTER_RE = /^\(([a-z])\)\s/; // "(a)", "(b)", "(c)"

type ClauseLevel = 'top' | 'roman' | 'letter';

function classifyParagraph(
  para: string
): { level: ClauseLevel; ref: string } | null {
  const t = para.trimStart();
  let m: RegExpMatchArray | null;
  if ((m = t.match(TOP_DOT_RE))) return { level: 'top', ref: m[1] };
  if ((m = t.match(TOP_PAREN_RE))) return { level: 'top', ref: `${m[1]}(${m[2]})` };
  if ((m = t.match(SUB_ROMAN_RE)))
    return { level: 'roman', ref: `(${(m[1] + m[2]).toLowerCase()})` };
  if ((m = t.match(SUB_LETTER_RE))) return { level: 'letter', ref: `(${m[1]})` };
  return null;
}

interface ClauseState {
  top?: string;
  roman?: string;
  letter?: string;
}

function buildRefString(state: ClauseState): string | undefined {
  const s = `${state.top || ''}${state.roman || ''}${state.letter || ''}`;
  return s || undefined;
}

export function chunkText(rawText: string, options: ChunkOptions = {}): Chunk[] {
  const { maxWords = 220, overlapWords = 40 } = options;

  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferWordCount = 0;
  let bufferStartRef: string | undefined;
  const state: ClauseState = {};

  const flush = () => {
    if (buffer.length > 0) {
      chunks.push({ text: buffer.join('\n\n').trim(), clauseRef: bufferStartRef });
      buffer = [];
      bufferWordCount = 0;
    }
  };

  for (const para of paragraphs) {
    const cls = classifyParagraph(para);
    if (cls) {
      // Any new clause marker — top, roman, or letter — is a hard chunk
      // boundary. Flushing here (rather than only at the top level) keeps
      // every chunk's clause_ref exactly as precise as the text it
      // contains, instead of silently reverting to a coarser parent label
      // once the buffer has accumulated a couple of sub-clauses.
      flush();
      if (cls.level === 'top') {
        state.top = cls.ref;
        state.roman = undefined;
        state.letter = undefined;
      } else if (cls.level === 'roman') {
        state.roman = cls.ref;
        state.letter = undefined;
      } else {
        state.letter = cls.ref;
      }
    }
    // Unmarked paragraphs ("Explanation:", "Provided that,") attach to
    // whatever clause is currently active rather than resetting it.

    const words = para.split(/\s+/);

    if (words.length > maxWords) {
      flush();
      let start = 0;
      while (start < words.length) {
        const end = Math.min(start + maxWords, words.length);
        chunks.push({
          text: words.slice(start, end).join(' '),
          clauseRef: buildRefString(state),
        });
        if (end === words.length) break;
        start = end - overlapWords;
      }
      continue;
    }

    if (bufferWordCount + words.length > maxWords) flush();
    if (buffer.length === 0) bufferStartRef = buildRefString(state);
    buffer.push(para);
    bufferWordCount += words.length;
  }

  flush();
  return chunks.filter((c) => c.text.length > 0);
}
