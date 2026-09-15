// 个人标记（划线）的样式常量（spec 0009）：马克笔高光 / 实线下划线 / 波浪线。
// 纯数据模块，客户端组件与 schema/服务端共用；枚举字面量与 db 的 mark_style 一致。

export const markStyles = ["highlight", "underline", "squiggle"] as const;

export type MarkStyle = (typeof markStyles)[number];

export const markStyleLabels: Record<MarkStyle, string> = {
  highlight: "马克笔",
  underline: "直线",
  squiggle: "波浪线",
};

export function isMarkStyle(value: unknown): value is MarkStyle {
  return typeof value === "string" && (markStyles as readonly string[]).includes(value);
}

/** 个人标记的客户端视图：status=located 时 start/end 是现行修订上的规范化偏移。 */
export interface PersonalMarkView {
  id: number;
  style: MarkStyle;
  quote: string;
  createdAt: string;
  status: "located" | "original-changed";
  start: number | null;
  end: number | null;
}

/** located 视图的收窄类型：start/end 非空，可直接参与渲染与相交计算。 */
export type LocatedMarkView = PersonalMarkView & { start: number; end: number };

export function isLocatedMark(mark: PersonalMarkView): mark is LocatedMarkView {
  return mark.status === "located" && mark.start !== null && mark.end !== null;
}

/** 标记读写接口的响应体（写操作后整表回传，客户端直接替换本地状态）。 */
export interface PersonalMarksState {
  revisionId: number;
  marks: PersonalMarkView[];
  defaultStyle: MarkStyle;
}
