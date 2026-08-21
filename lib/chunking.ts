/**
 * Chunker tuned for Indian regulatory circulars, which nest provisions in a
 * nearly-universal pattern:
 *   126C.  <top-level clause, "N" or "NA"/"NB" or "N(M)" style>
 *     (iii) <roman-numeral sub-clause>
 *       (a)  <lettered sub-sub-clause>
 * Cross-references to OTHER documents/regulations (e.g. "Section 45L of the
 * RBI Act", "regulation 14 of the SEBI (InvIT) Regulations") appear
 * mid-sentence, never at the start of a line — so anchoring detection to
 * line-start position naturally excludes them without needing a keyword list.
 *
 * IMPORTANT — this depends on pdf-parse's actual output shape, not an
 * idealized one: pdf-parse (v1.x, as used in lib/pdf.ts) emits a single \n
 * after nearly every visual line of the source PDF, including between
 * separate numbered clauses — it does NOT reliably insert blank lines
 * between semantic paragraphs the way a hand-written or web-sourced text
 * file would. So paragraphs can't be recovered by splitting on blank lines;
 * instead we split into individual lines and treat any line that STARTS
 * with a clause marker as the beginning of a new logical paragraph,
 * joining everything else as a line-wrapped continuation. Quoted clause
 * openings (e.g. a curly opening quote before "126A.") are stripped before
 * matching, since legal text commonly opens an inserted block that way.
 *
 * Each detected clause marker forces a chunk boundary. This trades chunk
 * count (more, smaller chunks) for citation precision (every chunk's
 * clause_ref is exactly the provision it contains, never a coarser parent
 * label borrowed from whichever line happened to start the buffer).
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

// Straight and curly quote marks that can precede a clause marker at the
// start of a quoted/inserted block, e.g. "126A. AIFIs shall be permitted...
const LEADING_QUOTE_RE = /^["'\u2018\u2019\u201C\u201D]+/;

type ClauseLevel = 'top' | 'roman' | 'letter';

function classifyLine(line: string): { level: ClauseLevel; ref: string } | null {
  const t = line.trimStart().replace(LEADING_QUOTE_RE, '').trimStart();
  let m: RegExpMatchArray | null;
  if ((m = t.match(TOP_DOT_RE))) return { level: 'top', ref: m[1] };
  if ((m = t.match(TOP_PAREN_RE))) return { level: 'top', ref: `${m[1]}(${m[2]})` };
  if ((m = t.match(SUB_ROMAN_RE)))
    return { level: 'roman', ref: `(${(m[1] + m[2]).toLowerCase()})` };
  if ((m = t.match(SUB_LETTER_RE))) return { level: 'letter', ref: `(${m[1]})` };
  return null;
}

/**
 * Reconstructs logical paragraphs from pdf-parse's line-per-visual-row
 * output. A line starting with a clause marker begins a new paragraph;
 * every other line is a line-wrapped continuation and gets joined with a
 * space onto the paragraph currently being built.
 */
function reconstructParagraphs(rawText: string): string[] {
  const rawLines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of rawLines) {
    const cls = classifyLine(line);
    if (cls && current.length > 0) {
      paragraphs.push(current.join(' '));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current.join(' '));

  return paragraphs;
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

  // Collapse the repeated inter-word spacing pdf-parse sometimes emits
  // (an artifact of justified-text layout reconstruction) so chunk text
  // shown in citations reads cleanly, not "shall  be  inserted" with
  // doubled spaces.
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const paragraphs = reconstructParagraphs(normalized);

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
    const cls = classifyLine(para);
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
    // Unmarked lines/paragraphs ("Explanation:", "Provided that,") attach
    // to whatever clause is currently active rather than resetting it.

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
