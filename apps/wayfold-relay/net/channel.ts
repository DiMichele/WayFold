/** The Network page tells the browsing window how the optical link is doing. */
export const NET_CHANNEL = "wf-net";

export type NetBroadcast =
  | { t: "status"; running: boolean; role: "share" | "join"; state: string; linkUp: boolean; inBps: number; outBps: number; inBytes: number; outBytes: number }
  | { t: "gone" };
