/**
 * Validation and sanitization of uploaded evidence images. Pure functions on bytes, no I/O
 * and no dependencies (docs/evidence.md, "Validation").
 *
 * - The type is detected from the file's signature. The client's MIME type and file name
 *   are never trusted (they are not even stored).
 * - Only JPEG and PNG are accepted: what phone cameras and the image picker produce, and
 *   formats that cannot carry scripts.
 * - Dimensions are read from the file header and bounded, which also protects any later
 *   image processing (thumbnails, Phase 5 media workers) from decompression bombs.
 * - Metadata is removed. JPEG EXIF can contain the GPS position, the device model and the
 *   owner's name; the job already records where work happened, deliberately and visibly.
 *   The EXIF orientation is the one value kept (in a minimal EXIF block of its own), because
 *   camera photos are often stored sideways and rotated on display.
 *
 * Pixel data is copied untouched: nothing here decodes or re-encodes the image.
 */

export type EvidenceContentType = 'image/jpeg' | 'image/png';

export interface SanitizedImage {
  readonly contentType: EvidenceContentType;
  readonly extension: 'jpg' | 'png';
  readonly width: number;
  readonly height: number;
  /** The file to store: the original minus its metadata. */
  readonly data: Buffer;
}

export type ImageRejection =
  /** Not a JPEG or PNG file. */
  | 'unsupported'
  /** Claims to be one but its structure is broken or truncated. */
  | 'malformed'
  /** Wider, taller or larger in pixel count than allowed. */
  | 'dimensions';

export type ImageInspection =
  | { readonly ok: true; readonly image: SanitizedImage }
  | { readonly ok: false; readonly reason: ImageRejection };

export const IMAGE_LIMITS = {
  /** Longest side in pixels (the app resizes to 1920 before upload). */
  maxSide: 10_000,
  /** 40 megapixels. */
  maxPixels: 40_000_000,
} as const;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function inspectImage(input: Buffer): ImageInspection {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8) {
    return checked(sanitizeJpeg(input));
  }
  if (
    input.length >= PNG_SIGNATURE.length &&
    input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return checked(sanitizePng(input));
  }
  return { ok: false, reason: 'unsupported' };
}

function checked(image: SanitizedImage | null): ImageInspection {
  if (image === null) {
    return { ok: false, reason: 'malformed' };
  }
  const { width, height } = image;
  if (
    width < 1 ||
    height < 1 ||
    width > IMAGE_LIMITS.maxSide ||
    height > IMAGE_LIMITS.maxSide ||
    width * height > IMAGE_LIMITS.maxPixels
  ) {
    return { ok: false, reason: 'dimensions' };
  }
  return { ok: true, image };
}

// ---- JPEG ------------------------------------------------------------------------------

/** Start-of-frame markers that carry the image size (SOF0–SOF15 except DHT, JPG, DAC). */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/**
 * Walks the marker segments up to the start of scan, keeping everything except APP1–APP15
 * (EXIF, XMP, ICC-less vendor data, IPTC) and comments. APP0 (JFIF) is kept: it holds only
 * the pixel density. Returns null for a structurally invalid file.
 */
function sanitizeJpeg(input: Buffer): SanitizedImage | null {
  let position = 2;
  let jfif: Buffer | null = null;
  const kept: Buffer[] = [];
  let orientation: number | undefined;
  let width = 0;
  let height = 0;
  let scan: Buffer | null = null;

  while (position < input.length) {
    if (input[position] !== 0xff) {
      return null;
    }
    // Any number of 0xFF fill bytes may precede a marker.
    while (position < input.length && input[position] === 0xff) {
      position += 1;
    }
    if (position >= input.length) {
      return null;
    }
    const marker = input[position] ?? 0;
    const markerStart = position - 1;
    position += 1;

    if (marker === 0xda) {
      // Start of scan: the entropy-coded image data and the rest of the file, verbatim.
      scan = input.subarray(markerStart);
      break;
    }
    if (marker === 0xd9) {
      // End of image before any scan: no picture in it.
      return null;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(input.subarray(markerStart, position));
      continue;
    }
    if (position + 2 > input.length) {
      return null;
    }
    const length = input.readUInt16BE(position);
    if (length < 2 || position + length > input.length) {
      return null;
    }
    const segment = input.subarray(markerStart, position + length);
    const payload = input.subarray(position + 2, position + length);
    position += length;

    if (isStartOfFrame(marker)) {
      if (payload.length < 5) {
        return null;
      }
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
      kept.push(segment);
    } else if (marker === 0xe0) {
      jfif ??= segment;
    } else if (marker === 0xe1) {
      orientation ??= exifOrientation(payload);
    } else if ((marker >= 0xe2 && marker <= 0xef) || marker === 0xfe) {
      // Other application segments and comments: dropped.
    } else {
      kept.push(segment);
    }
  }

  if (scan === null || width === 0 || height === 0) {
    return null;
  }
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (jfif !== null) {
    parts.push(jfif);
  }
  if (orientation !== undefined && orientation !== 1) {
    parts.push(orientationSegment(orientation));
  }
  parts.push(...kept, scan);
  return {
    contentType: 'image/jpeg',
    extension: 'jpg',
    width,
    height,
    data: Buffer.concat(parts),
  };
}

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const ORIENTATION_TAG = 0x0112;

/** The orientation (1–8) from an APP1 EXIF payload, if it has a valid one. */
export function exifOrientation(payload: Buffer): number | undefined {
  if (!payload.subarray(0, 6).equals(EXIF_HEADER)) {
    return undefined;
  }
  const tiff = payload.subarray(6);
  if (tiff.length < 8) {
    return undefined;
  }
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') {
    return undefined;
  }
  const little = order === 'II';
  const u16 = (offset: number) =>
    little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const u32 = (offset: number) =>
    little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  if (u16(2) !== 42) {
    return undefined;
  }
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) {
    return undefined;
  }
  const entries = u16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) {
      return undefined;
    }
    // Type 3 = SHORT; the value sits in the first two bytes of the value field.
    if (u16(entry) === ORIENTATION_TAG && u16(entry + 2) === 3) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/** A minimal APP1 EXIF segment containing only IFD0 with the orientation tag. */
export function orientationSegment(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 right after the header
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(ORIENTATION_TAG, 10);
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(2 + EXIF_HEADER.length + tiff.length, 2);
  return Buffer.concat([header, EXIF_HEADER, tiff]);
}

// ---- PNG -------------------------------------------------------------------------------

/** Ancillary chunks that carry metadata (EXIF, text, modification time). */
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/**
 * Copies every chunk up to and including IEND except metadata chunks (whole chunks, so their
 * CRCs stay valid). Data after IEND is discarded. Returns null for a malformed file.
 */
function sanitizePng(input: Buffer): SanitizedImage | null {
  let position = PNG_SIGNATURE.length;
  const parts: Buffer[] = [PNG_SIGNATURE];
  let width = 0;
  let height = 0;
  let first = true;
  let ended = false;

  while (position + 12 <= input.length) {
    const length = input.readUInt32BE(position);
    const type = input.toString('latin1', position + 4, position + 8);
    const end = position + 12 + length;
    if (length > 0x7fffffff || end > input.length) {
      return null;
    }
    if (first) {
      if (type !== 'IHDR' || length !== 13) {
        return null;
      }
      width = input.readUInt32BE(position + 8);
      height = input.readUInt32BE(position + 12);
      first = false;
    }
    if (!PNG_METADATA_CHUNKS.has(type)) {
      parts.push(input.subarray(position, end));
    }
    position = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }

  if (!ended || width === 0 || height === 0) {
    return null;
  }
  return {
    contentType: 'image/png',
    extension: 'png',
    width,
    height,
    data: Buffer.concat(parts),
  };
}
