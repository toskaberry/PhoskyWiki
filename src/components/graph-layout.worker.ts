import { layoutGraph } from "@/lib/graph-layout";
import type { SiteGraphData } from "@/lib/graph-types";

self.onmessage = (event: MessageEvent<{ data: SiteGraphData; rootId?: number }>) => {
  self.postMessage(layoutGraph(event.data.data, event.data.rootId));
};
