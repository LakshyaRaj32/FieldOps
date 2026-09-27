import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type CameraOptions,
  type ImagePickerResponse,
} from 'react-native-image-picker';

/**
 * Taking or choosing a photo for job evidence, through react-native-image-picker (the only
 * importer, enforced by ESLint). The system camera app is used through an intent, so the app
 * needs no CAMERA permission; the gallery uses Android's photo picker.
 *
 * Photos are resized on the phone before anything else happens: a field photo does not need
 * more than 1920 px, and a smaller file uploads faster on a weak connection and keeps the
 * device's pending storage small (docs/evidence.md, "Limits").
 */
const OPTIONS: CameraOptions = {
  mediaType: 'photo',
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8,
  includeBase64: false,
  includeExtra: false,
  saveToPhotos: false,
};

/** Types the API accepts (it checks the bytes itself; this only avoids a doomed upload). */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;
export type PickedPhotoType = (typeof ACCEPTED_TYPES)[number];

export interface PickedPhoto {
  /** Temporary `file://` URI in the app's cache: import it before relying on it. */
  readonly uri: string;
  readonly type: PickedPhotoType;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
}

export type PhotoPickResult =
  | { readonly kind: 'picked'; readonly photo: PickedPhoto }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'camera_unavailable' }
  | { readonly kind: 'permission' }
  | { readonly kind: 'error'; readonly message: string };

/** Interprets the picker's response. Exported for tests. */
export function toPickResult(response: ImagePickerResponse): PhotoPickResult {
  if (response.didCancel === true) {
    return { kind: 'cancelled' };
  }
  switch (response.errorCode) {
    case undefined:
      break;
    case 'camera_unavailable':
      return { kind: 'camera_unavailable' };
    case 'permission':
      return { kind: 'permission' };
    default:
      return { kind: 'error', message: response.errorMessage ?? 'unknown' };
  }
  const asset: Asset | undefined = response.assets?.[0];
  if (asset?.uri === undefined) {
    return { kind: 'cancelled' };
  }
  const type = asset.type?.toLowerCase();
  if (!ACCEPTED_TYPES.includes(type as PickedPhotoType)) {
    return { kind: 'unsupported' };
  }
  return {
    kind: 'picked',
    photo: {
      uri: asset.uri,
      type: type as PickedPhotoType,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      sizeBytes: asset.fileSize ?? 0,
    },
  };
}

export async function takePhoto(): Promise<PhotoPickResult> {
  try {
    return toPickResult(await launchCamera(OPTIONS));
  } catch (error) {
    return { kind: 'error', message: String(error) };
  }
}

export async function choosePhoto(): Promise<PhotoPickResult> {
  try {
    return toPickResult(
      await launchImageLibrary({ ...OPTIONS, selectionLimit: 1 }),
    );
  } catch (error) {
    return { kind: 'error', message: String(error) };
  }
}
