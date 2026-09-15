/** Client projection of a thought; private rows are filtered on the server. */
export interface ThoughtView {
  id: number;
  pageId: number;
  content: string;
  quote: string;
  baseRevisionId: number;
  visibility: "public" | "private";
  authorId: string;
  authorName: string;
  authorImage: string | null;
  createdAt: string;
  deleted: boolean;
  agreeCount: number;
  agreed: boolean;
  status: "located" | "original-changed";
  start: number | null;
  end: number | null;
  canDelete: boolean;
  replyable: boolean;
  replies: {
    id: number;
    content: string;
    authorId: string;
    authorName: string;
    createdAt: string;
    deleted: boolean;
    canDelete: boolean;
  }[];
}

export interface PageThoughtsState {
  thoughts: ThoughtView[];
  revisionId: number;
  locked: boolean;
}
