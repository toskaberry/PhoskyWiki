// 句子面板的感想投影（spec 0009 #73）：把已定位的感想按句子聚合，供正文虚线渲染与
// 句内感想面板共用。
//
// 归属规则：感想覆盖到的每一句都算（同一句只出现一次，不论几条感想覆盖）。选中一句里的
// 几个字也算这句话上的感想，跨句跨段的选择则同时属于沿途每一句。渲染端据此对同一句只画
// 一条虚线；句子面板列出覆盖该句的全部感想。无法定位的感想（原文已变更）不参与句子聚合，
// 只出现在「原文已变化的想法」入口。

import type { PassageSentence } from "@/lib/passage-anchors";

/** 定位状态与现行区间；与 PersonalMarkView 的定位字段同形。 */
type LocatedThought = {
  status: "located" | "original-changed";
  start: number | null;
  end: number | null;
};

/**
 * 句子 → 覆盖该句的感想（句子原顺序；句内保持传入顺序，即赞同数降序）。
 * 没有感想的句子不出现在结果里，调用端据此渲染虚线标记。
 */
export function thoughtsBySentence<T extends LocatedThought>(
  sentences: PassageSentence[],
  thoughts: T[],
): { sentence: PassageSentence; thoughts: T[] }[] {
  const located = thoughts.filter(
    (thought): thought is T & { start: number; end: number } =>
      thought.status === "located" && thought.start !== null && thought.end !== null,
  );
  const groups = new Map<PassageSentence, T[]>();
  for (const thought of located) {
    for (const sentence of sentences) {
      if (sentence.start >= thought.end) break;
      if (sentence.end <= thought.start) continue;
      const bucket = groups.get(sentence);
      if (bucket) bucket.push(thought);
      else groups.set(sentence, [thought]);
    }
  }
  return sentences
    .filter(sentence => groups.has(sentence))
    .map(sentence => ({ sentence, thoughts: groups.get(sentence)! }));
}
