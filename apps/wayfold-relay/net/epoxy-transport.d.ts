declare module "@mercuryworkshop/epoxy-transport" {
  import type { BareTransport } from "@mercuryworkshop/bare-mux";

  export interface WispMessageStreams {
    read: ReadableStream<ArrayBuffer>;
    write: WritableStream<Uint8Array>;
  }

  export default class EpoxyTransport implements BareTransport {
    constructor(opts: {
      wisp: string | (() => WispMessageStreams | Promise<WispMessageStreams>);
      wisp_v2?: boolean;
      buffer_size?: number;
      /** PEM certificates of extra certificate authorities, for company intranets. */
      pem_files?: string[];
      /** Accepts any certificate. Used only by the offline package's local exit. */
      disable_certificate_validation?: boolean;
    });
    ready: boolean;
    init: BareTransport["init"];
    connect: BareTransport["connect"];
    request: BareTransport["request"];
    meta: BareTransport["meta"];
  }
}
