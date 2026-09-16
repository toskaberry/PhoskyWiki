import { describe, expect, it } from "vitest";
import { thoughtsBySentence } from "../../src/lib/thought-sentences";

const sentences = [
  { start: 0, end: 5, text: "第一句。" },
  { start: 5, end: 10, text: "第二句。" },
  { start: 11, end: 16, text: "第三句。" },
];

describe("sentence thought projection", () => {
  it("aggregates a partial selection and a cross-sentence/cross-paragraph selection without boundary duplicates", () => {
    const thoughts = [
      { id: 1, status: "located" as const, start: 1, end: 3 },
      { id: 2, status: "located" as const, start: 4, end: 14 },
      { id: 3, status: "located" as const, start: 5, end: 10 },
      { id: 4, status: "original-changed" as const, start: null, end: null },
    ];
    expect(thoughtsBySentence(sentences, thoughts).map(group => group.thoughts.map(thought => thought.id)))
      .toEqual([[1, 2], [2, 3], [2]]);
  });
  it("omits sentences without a located thought", () => {
    expect(thoughtsBySentence(sentences, [{ id: 1, status: "original-changed" as const, start: null, end: null }]))
      .toEqual([]);
  });
});
