import { toPickResult } from './photoPicker';

describe('toPickResult', () => {
  it('returns the photo the camera or gallery produced', () => {
    expect(
      toPickResult({
        assets: [
          {
            uri: 'file:///cache/rn_image_picker_1.jpg',
            type: 'image/jpeg',
            width: 1920,
            height: 1440,
            fileSize: 412_000,
          },
        ],
      }),
    ).toEqual({
      kind: 'picked',
      photo: {
        uri: 'file:///cache/rn_image_picker_1.jpg',
        type: 'image/jpeg',
        width: 1920,
        height: 1440,
        sizeBytes: 412_000,
      },
    });
  });

  it('reports cancellation and picker errors', () => {
    expect(toPickResult({ didCancel: true })).toEqual({ kind: 'cancelled' });
    expect(toPickResult({ errorCode: 'camera_unavailable' })).toEqual({
      kind: 'camera_unavailable',
    });
    expect(toPickResult({ errorCode: 'permission' })).toEqual({
      kind: 'permission',
    });
    expect(
      toPickResult({ errorCode: 'others', errorMessage: 'boom' }),
    ).toEqual({ kind: 'error', message: 'boom' });
  });

  it('refuses types the server would reject (HEIC, GIF, video)', () => {
    for (const type of ['image/heic', 'image/gif', 'video/mp4', undefined]) {
      expect(
        toPickResult({ assets: [{ uri: 'file:///x', ...(type && { type }) }] }),
      ).toEqual({ kind: 'unsupported' });
    }
  });
});
