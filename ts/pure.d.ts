// The one global the pure modules (ts/src/) use beyond ES2020: TextEncoder, which every browser and
// Node have (ics.ts counts a line's UTF-8 octets with it). Declared here, in the same shape as the
// DOM library's, so that tsconfig.src.json can check ts/src/ with no DOM at all; with the DOM library
// present (tsconfig.json) the two declarations merge. Emits nothing.

interface TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
}
declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};
