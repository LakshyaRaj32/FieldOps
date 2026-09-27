import type { ImageSourcePropType } from 'react-native';

import { getConfig } from '../../../app/config';
import { credentialStore } from '../../../services/auth/credentialStore';
import { evidenceContentPath } from '../api/jobsApi';

/**
 * An image source for a photo stored on the server. The download is authorized like every
 * other request (the photo is only served to people who may see the job), so the current
 * access token travels as a header; it is read at render time and never stored.
 */
export function serverEvidenceSource(
  jobId: string,
  evidenceId: string,
): ImageSourcePropType {
  const token = credentialStore.getAccessToken();
  return {
    uri: `${getConfig().apiBaseUrl}${evidenceContentPath(jobId, evidenceId)}`,
    ...(token !== undefined && {
      headers: { Authorization: `Bearer ${token}` },
    }),
  };
}
