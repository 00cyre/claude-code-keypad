import { open } from "creator-micro-kit";

/**
 * USB product ids for the Creator Micro 2.
 *
 * The same keypad reports under either one depending on how the firmware
 * enumerates, so both have to be tried before concluding it is not there.
 * Pinning only 0x8298 would leave the units that come up as 0x8297 unable to
 * open at all — which is worse than the first-device-wins behaviour this
 * filter exists to replace, because at least that found them.
 */
export const CREATOR_MICRO_V2_IDS = [0x8298, 0x8297];

/**
 * Opens the keypad, trying each candidate product id in turn.
 *
 * `productIds` of null means no filter: open whatever Work Louder device is
 * there first, which is what `--product-id any` restores.
 */
export async function openKeypad(productIds, options = {}, opener = open) {
  if (!productIds || productIds.length === 0) return opener(options);

  let last;
  for (const productId of productIds) {
    try {
      return await opener({ ...options, productId });
    } catch (error) {
      last = error;
    }
  }
  // The last failure, not a summary: the caller prints it while waiting for
  // the device, and "no Work Louder device found" is the useful thing to see.
  throw last;
}
