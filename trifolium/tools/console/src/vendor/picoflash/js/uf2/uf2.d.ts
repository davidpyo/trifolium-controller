// Ours, not upstream's. See the README two levels up.

/**
 * Unpacks a .uf2's 512-byte blocks into one flat buffer, gaps filled with 0xFF.
 *
 * Throws on a bad magic or a short block. The address is the lowest any block names, so an image
 * that does not start at the flash base is reported rather than silently relocated.
 */
export declare function uf2ToFlashBuffer(uf2Data: Uint8Array): {
  address: number;
  data: Uint8Array;
};
