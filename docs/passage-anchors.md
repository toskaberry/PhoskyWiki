# Passage Anchors

Issue #67 provides a pure algorithm boundary in `src/lib/passage-anchors.ts`.
It performs no IO, changes no DOM, and does not persist annotations. Callers own
page identity, authorization, revision loading, and rendering.

## Rendered Text Contract

`indexPassage(root)` accepts the rendered Markdown body root as a DOM `Node`,
or a structural snapshot with `nodeType`, `nodeName`, `nodeValue`, and
`childNodes`. It returns canonical text, sentence ranges, and a node-offset map.
Do not pass Markdown source or a container including toolbars and comments.
Rebuild the index when the body DOM changes. Both historical and current bodies
must use this same projection; the existing Agent-oriented `renderMarkdownText`
has different whitespace rules and is not an interchangeable anchor source.
A server adapter can project the sanitized rendered tree into `PassageNode`
without creating a browser. That adapter lives in `src/lib/passage-body.ts`
(`indexMarkdownBody` / `canonicalMarkdownText`); the personal-marks feature
(spec 0009) is its first consumer.

- Text in inline emphasis, links (including wiki links), and inline code remains
  contiguous. Link destinations, Markdown syntax, image alt text, comments,
  scripts, styles, and template content do not contribute offsets.
- Paragraphs, headings, list items, blockquotes, preformatted blocks, and block
  containers have line boundaries. Nested containers do not add repeated blank
  lines. List markers are not text. Each heading or list item participates in
  sentence aggregation just like a paragraph; blockquotes retain their inner
  paragraph boundaries. `br` and `hr` introduce a boundary.
- Normal HTML whitespace (space, tab, CR, LF, form feed) collapses to one space
  across inline nodes, with leading whitespace after a boundary ignored.
  `pre` preserves whitespace, and each newline is a sentence boundary.
  A trailing block newline is retained in canonical text. NBSP is preserved.
- This is a semantic Markdown projection, not a CSS layout or `innerText`
  implementation. It assumes the sanitized Markdown renderer's visible body;
  arbitrary CSS-hidden elements and generated content are outside the contract.

## Sentences And Selection

Offsets are UTF-16 code units, matching JavaScript `slice` and DOM Range, with
half-open intervals `[start, end)`. Emoji therefore commonly occupy two units.
No Unicode normalization or Markdown-source offset conversion is performed.

`splitSentences(text)` splits at Chinese full stops, Chinese/ASCII question and
exclamation marks, two or more ellipsis characters, and CR/LF boundaries. Mixed
terminal punctuation and following closing quotes/brackets belong to the
preceding sentence. Commas, semicolons, colons, a single ellipsis, and ASCII
periods do not split sentences (preserving decimals, abbreviations, and URLs).
Sentence-edge whitespace is excluded, without shifting content offsets.

`sentencesForRange` returns all sentences with a nonempty intersection. Partial
coverage counts; merely touching an endpoint does not. Cross-sentence and
cross-paragraph selections belong to every intersected sentence. Separators
alone belong to none. Empty and out-of-bounds ranges are rejected.

`serializeSelection(index, anchorPoint, focusPoint, baseRevisionId)` accepts
text-node character offsets or element child indices. Backward selections are
ordered automatically. Foreign nodes, invalid offsets, empty revisions, collapsed
selections, and whitespace-only selections return `null`. A successful anchor
contains `start`, `end`, the exact canonical `quote`, and `baseRevisionId`.

`deserializeSelection(index, range)` returns DOM boundary points suitable for
`Range.setStart` / `Range.setEnd`, or `null` for invalid/unrepresentable ranges.
Equivalent DOM boundaries and collapsed whitespace canonicalize: the guarantee
is identical content offsets and quote after reserialization, not identical
node identity or selection direction. Deserialize only ranges for that indexed
body, including a successful relocation's range; old offsets alone are unsafe.

## Revision Relocation

`relocateAnchor(anchor, { revisionId, text }, currentText)` verifies the base
revision ID, offsets, and quote before attempting a relocation. The caller must
also ensure that both revisions belong to the anchor's perspective.

An unchanged canonical body uses the saved offsets, including repeated text.
Otherwise, the algorithm protects the entire sentences touched by the selection,
not only the selected substring. It composes the existing bounded `diffInline`
character diff: the protected span must survive in one unchanged run and its
sentence boundaries and text must still agree in the current body. Edits before
or after that span can shift its offsets. The returned quote range remains exact;
the returned sentence collection is for current-body public-marker aggregation.

Rewrites anywhere in a touched sentence, deletion, sentence merges/extensions,
missing matches, or exhausted diff limits return `{ status: "original-changed" }`,
rendered by callers as “原文已变更”. A protected span repeated in either changed
body is also rejected conservatively, even if a diff could arbitrarily pick one
copy. No fuzzy match or nearest-copy fallback reattaches historical discussions.
The original quote and revision remain unchanged for historical reading.

Validation lives in `tests/unit/passage-anchors.test.ts`, exercising the public
algorithm interfaces with rendered-node fixtures and revision matrices.
