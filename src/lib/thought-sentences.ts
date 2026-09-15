import type { PassageSentence } from "@/lib/passage-anchors";

type LocatedThought = { status: "located" | "original-changed"; start: number | null; end: number | null };

export function thoughtsBySentence<T extends LocatedThought>(sentences: PassageSentence[], thoughts: T[]): { sentence: PassageSentence; thoughts: T[] }[] {
  void sentences;
  void thoughts;
  return [];
}
