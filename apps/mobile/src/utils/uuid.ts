/**
 * UUIDv7 (RFC 9562): 48 bits of millisecond time, then random bits. Used for IDs created on
 * the device (outbox mutations, field notes), so they sort by creation time like the
 * server's UUIDv7 keys and never need remapping after sync.
 *
 * The random bits come from Math.random: these IDs must be unique, not secret, and Hermes has
 * no Web Crypto. Switch to a CSPRNG (react-native-get-random-values) if an ID ever needs to
 * be unguessable.
 */
export function uuidv7(
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  const bytes: number[] = [];
  let time = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  for (let index = 6; index < 16; index += 1) {
    bytes[index] = Math.floor(random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant

  const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
