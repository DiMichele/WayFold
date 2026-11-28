/**
 * Mono video keeps seq 0 on screen so the camera can freeze one QR.
 * Color video puts a distinct fountain seq of the same session on each channel.
 * Codec, bitrate, resolution and the video container stay untouched.
 */
export function videoBatchKind(channels: number): "repeat-still" | "distinct-seqs" {
  return channels > 1 ? "distinct-seqs" : "repeat-still";
}
