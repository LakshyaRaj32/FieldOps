import {
  exifOrientation,
  IMAGE_LIMITS,
  inspectImage,
  orientationSegment,
} from './evidence-image.js';

/** A JPEG marker segment: FF <marker> <length> <payload>. */
function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xff00 | marker, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function sof0(width: number, height: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt8(8, 0); // precision
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload.writeUInt8(1, 5); // components (truncated list is fine for the parser)
  return segment(0xc0, payload);
}

/** EXIF APP1 (little-endian) with orientation and an extra tag standing in for GPS data. */
function exif(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  // 0x8825 GPSInfo pointer (the data we want gone).
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(0xdeadbeef, 18);
  // Orientation.
  tiff.writeUInt16LE(0x0112, 22);
  tiff.writeUInt16LE(3, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt16LE(orientation, 30);
  return segment(
    0xe1,
    Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]),
  );
}

const SOI = Buffer.from([0xff, 0xd8]);
const JFIF = segment(
  0xe0,
  Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
);
const COMMENT = segment(0xfe, Buffer.from('Owner: Asha Verma', 'latin1'));
const XMP = segment(
  0xe1,
  Buffer.from('http://ns.adobe.com/xap/1.0/\0<gps/>', 'latin1'),
);
const SCAN = Buffer.concat([
  segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), // entropy-coded data with a stuffed FF
  Buffer.from([0xff, 0xd9]),
]);

function jpeg(...parts: Buffer[]): Buffer {
  return Buffer.concat([SOI, ...parts, SCAN]);
}

describe('inspectImage — JPEG', () => {
  it('accepts a JPEG and reads its dimensions from the frame header', () => {
    const result = inspectImage(jpeg(JFIF, sof0(1920, 1080)));
    expect(result).toMatchObject({
      ok: true,
      image: {
        contentType: 'image/jpeg',
        extension: 'jpg',
        width: 1920,
        height: 1080,
      },
    });
  });

  it('removes EXIF, XMP and comments but keeps the orientation', () => {
    const result = inspectImage(
      jpeg(JFIF, exif(6), XMP, COMMENT, sof0(640, 480)),
    );
    if (!result.ok) {
      throw new Error('expected ok');
    }
    const { data } = result.image;
    expect(data.includes(Buffer.from('Owner'))).toBe(false);
    expect(data.includes(Buffer.from('adobe'))).toBe(false);
    // The GPS pointer value is gone with the original EXIF block.
    const gps = Buffer.alloc(4);
    gps.writeUInt32LE(0xdeadbeef);
    expect(data.includes(gps)).toBe(false);
    // SOI, JFIF, then the minimal orientation block, then the rest.
    expect(data.subarray(0, 2)).toEqual(SOI);
    expect(data.subarray(2, 2 + JFIF.length)).toEqual(JFIF);
    const expected = orientationSegment(6);
    const app1 = data.subarray(
      2 + JFIF.length,
      2 + JFIF.length + expected.length,
    );
    expect(app1).toEqual(expected);
    // Pixel data untouched.
    expect(data.subarray(data.length - SCAN.length)).toEqual(SCAN);
  });

  it('adds no EXIF block when the orientation is the default', () => {
    const result = inspectImage(jpeg(exif(1), sof0(10, 10)));
    if (!result.ok) {
      throw new Error('expected ok');
    }
    expect(result.image.data.includes(Buffer.from('Exif'))).toBe(false);
  });

  it('rejects truncated and scan-less files as malformed', () => {
    const full = jpeg(JFIF, sof0(100, 100));
    expect(inspectImage(full.subarray(0, 30))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(
      inspectImage(
        Buffer.concat([SOI, sof0(10, 10), Buffer.from([0xff, 0xd9])]),
      ),
    ).toEqual({ ok: false, reason: 'malformed' });
    // No frame header: dimensions unknown.
    expect(inspectImage(jpeg(JFIF))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects images beyond the size limits', () => {
    expect(inspectImage(jpeg(sof0(IMAGE_LIMITS.maxSide + 1, 10)))).toEqual({
      ok: false,
      reason: 'dimensions',
    });
    expect(inspectImage(jpeg(sof0(8000, 8000)))).toEqual({
      ok: false,
      reason: 'dimensions',
    });
  });
});

/** A PNG chunk with a zero CRC (the sanitizer copies chunks, it does not verify CRCs). */
function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8);
  data.writeUInt8(2, 9);
  return chunk('IHDR', data);
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IDAT = chunk('IDAT', Buffer.from([1, 2, 3, 4]));
const IEND = chunk('IEND', Buffer.alloc(0));

describe('inspectImage — PNG', () => {
  it('accepts a PNG, reads its size and drops metadata chunks and trailing data', () => {
    const file = Buffer.concat([
      PNG_SIGNATURE,
      ihdr(800, 600),
      chunk('tEXt', Buffer.from('Author\0Asha', 'latin1')),
      chunk('eXIf', Buffer.from('MM\0*', 'latin1')),
      IDAT,
      IEND,
      Buffer.from('<script>'),
    ]);
    const result = inspectImage(file);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    expect(result.image).toMatchObject({
      contentType: 'image/png',
      width: 800,
      height: 600,
    });
    expect(result.image.data).toEqual(
      Buffer.concat([PNG_SIGNATURE, ihdr(800, 600), IDAT, IEND]),
    );
  });

  it('rejects a PNG without IHDR first or without IEND', () => {
    expect(inspectImage(Buffer.concat([PNG_SIGNATURE, IDAT, IEND]))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(
      inspectImage(Buffer.concat([PNG_SIGNATURE, ihdr(1, 1), IDAT])),
    ).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('inspectImage — other files', () => {
  it.each([
    ['a PDF', Buffer.from('%PDF-1.7\n')],
    ['an HTML file', Buffer.from('<html><script>alert(1)</script>')],
    ['a Windows executable', Buffer.from('MZ\x90\x00', 'latin1')],
    ['a GIF', Buffer.from('GIF89a')],
    ['an empty file', Buffer.alloc(0)],
  ])('rejects %s as unsupported', (_name, bytes) => {
    expect(inspectImage(bytes)).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('exifOrientation', () => {
  it('reads both byte orders and ignores out-of-range values', () => {
    const big = orientationSegment(8).subarray(4);
    expect(exifOrientation(big)).toBe(8);
    const little = exif(3).subarray(4);
    expect(exifOrientation(little)).toBe(3);
    expect(exifOrientation(exif(9).subarray(4))).toBeUndefined();
    expect(exifOrientation(Buffer.from('nope'))).toBeUndefined();
  });
});
