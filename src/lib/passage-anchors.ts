import { diffInline } from "@/lib/diff";

/** All offsets are UTF-16, half-open [start, end), like DOM Range offsets. */
export interface ContentRange {
  start: number;
  end: number;
}

export interface PassageSentence extends ContentRange {
  text: string;
}

/** Structural subset of DOM Node; also accepts an immutable rendered-tree snapshot. */
export interface PassageNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<PassageNode>;
}

export interface PassagePoint {
  node: PassageNode;
  offset: number;
}

export interface PassageAnchor extends ContentRange {
  quote: string;
  baseRevisionId: string;
}

export interface IndexedPassage {
  text: string;
  sentences: PassageSentence[];
  /** Node offsets map to canonical content offsets; rebuild after DOM changes. */
  boundaries: ReadonlyMap<PassageNode, readonly number[]>;
}

const blockTags = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR"]);
const omittedTags = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IMG"]);

/** Index only the rendered Markdown body, before adding annotation controls. */
export function indexPassage(root: PassageNode): IndexedPassage {
  let text = "";
  const boundaries = new Map<PassageNode, number[]>();
  function lineBreak() {
    if (text && !text.endsWith("\n")) text += "\n";
  }
  function visit(node: PassageNode, preformatted: boolean) {
    const tag = node.nodeName.toUpperCase();
    if (omittedTags.has(tag) || (node.nodeType !== 1 && node.nodeType !== 3 && node !== root)) return;
    if (node.nodeType === 3) {
      const offsets = [text.length];
      for (const character of (node.nodeValue ?? "").split("")) {
        if (!preformatted && /[\t\n\r\f ]/.test(character)) {
          if (text && !/[ \n]$/.test(text)) text += " ";
        } else {
          text += character;
        }
        offsets.push(text.length);
      }
      boundaries.set(node, offsets);
      return;
    }
    const block = blockTags.has(tag);
    if (block || tag === "BR") lineBreak();
    const offsets = [text.length];
    for (const child of Array.from(node.childNodes)) {
      visit(child, preformatted || tag === "PRE");
      offsets.push(text.length);
    }
    boundaries.set(node, offsets);
    if (block) lineBreak();
  }
  visit(root, false);
  return { text, sentences: splitSentences(text), boundaries };
}

function validRange(text: string, range: ContentRange): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 0 && range.start < range.end && range.end <= text.length;
}

export function sentencesForRange(passage: Pick<IndexedPassage, "text" | "sentences">, range: ContentRange): PassageSentence[] {
  if (!validRange(passage.text, range)) return [];
  return passage.sentences.filter((sentence) => sentence.start < range.end && sentence.end > range.start);
}

export function serializeSelection(
  passage: IndexedPassage,
  anchor: PassagePoint,
  focus: PassagePoint,
  baseRevisionId: string,
): PassageAnchor | null {
  if (!baseRevisionId || !Number.isInteger(anchor.offset) || !Number.isInteger(focus.offset)) return null;
  const a = passage.boundaries.get(anchor.node)?.[anchor.offset];
  const b = passage.boundaries.get(focus.node)?.[focus.offset];
  if (a === undefined || b === undefined) return null;
  const range = { start: Math.min(a, b), end: Math.max(a, b) };
  const quote = passage.text.slice(range.start, range.end);
  if (!quote.trim() || !sentencesForRange(passage, range).length) return null;
  return { ...range, quote, baseRevisionId };
}

/** Equivalent boundaries canonicalize to text nodes; content offsets round-trip exactly. */
export function deserializeSelection(passage: IndexedPassage, range: ContentRange): { start: PassagePoint; end: PassagePoint } | null {
  if (!validRange(passage.text, range)) return null;
  function pointAt(position: number, end: boolean): PassagePoint | null {
    let fallback: PassagePoint | null = null;
    for (const [node, offsets] of passage.boundaries) {
      const offset = end ? offsets.lastIndexOf(position) : offsets.indexOf(position);
      if (offset < 0) continue;
      const point = { node, offset };
      if (node.nodeType === 3 && (end ? offset > 0 : offset < offsets.length - 1)) return point;
      fallback ??= point;
    }
    return fallback;
  }
  const start = pointAt(range.start, false);
  const end = pointAt(range.end, true);
  return start && end ? { start, end } : null;
}

export function splitSentences(text: string): PassageSentence[] {
  const sentences: PassageSentence[] = [];
  const boundary = /(?:[。！？!?]|…{2,})+[”’」』）》】"']*|\r\n|\r|\n/gu;
  let cursor = 0;
  function append(end: number) {
    const chunk = text.slice(cursor, end);
    const trimmed = chunk.trim();
    if (trimmed) {
      const start = cursor + chunk.indexOf(trimmed);
      sentences.push({ start, end: start + trimmed.length, text: trimmed });
    }
    cursor = end;
  }
  for (const match of text.matchAll(boundary)) append(match.index + match[0].length);
  append(text.length);
  return sentences;
}

export type PassageLocation =
  | { status: "located"; range: ContentRange; sentences: PassageSentence[] }
  | { status: "original-changed" };

/** The caller loads the base revision and indexes both rendered bodies using the same rules. */
export function relocateAnchor(
  anchor: PassageAnchor,
  base: { revisionId: string; text: string },
  currentText: string,
): PassageLocation {
  const changed: PassageLocation = { status: "original-changed" };
  if (!anchor.baseRevisionId || anchor.baseRevisionId !== base.revisionId
    || !validRange(base.text, anchor) || base.text.slice(anchor.start, anchor.end) !== anchor.quote) return changed;
  const before = sentencesForRange({ text: base.text, sentences: splitSentences(base.text) }, anchor);
  if (!before.length) return changed;
  if (base.text === currentText) return { status: "located", range: { start: anchor.start, end: anchor.end }, sentences: before };

  // Protect the entire touched sentences, even when only a few characters were selected.
  const start = Math.min(anchor.start, before[0].start);
  const end = Math.max(anchor.end, before[before.length - 1].end);
  const context = base.text.slice(start, end);
  const uniqueIn = (text: string) => {
    const first = text.indexOf(context);
    return first >= 0 && text.indexOf(context, first + 1) < 0;
  };
  if (!uniqueIn(base.text) || !uniqueIn(currentText)) return changed;

  let oldOffset = 0;
  let newOffset = 0;
  for (const row of diffInline(base.text, currentText)) {
    const length = row.text.length;
    if (row.type === "same" && oldOffset <= start && oldOffset + length >= end) {
      const drift = newOffset - oldOffset;
      const range = { start: anchor.start + drift, end: anchor.end + drift };
      const after = sentencesForRange({ text: currentText, sentences: splitSentences(currentText) }, range);
      if (after.length !== before.length || after.some((sentence, i) =>
        sentence.start !== before[i].start + drift || sentence.end !== before[i].end + drift
        || sentence.text !== before[i].text)) return changed;
      return { status: "located", range, sentences: after };
    }
    if (row.type !== "add") oldOffset += length;
    if (row.type !== "del") newOffset += length;
  }
  return changed;
}
