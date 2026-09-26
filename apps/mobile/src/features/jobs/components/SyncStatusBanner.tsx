import React from 'react';

import { AppText } from '../../../components/ui';
import { useTheme, type AppTheme } from '../../../theme';
import { useOfflineJobs } from '../data/OfflineJobsContext';
import { describeSync, type SyncBanner } from '../presentation';

function colors(theme: AppTheme, tone: SyncBanner['tone']) {
  switch (tone) {
    case 'danger':
      return {
        background: theme.colors.dangerMuted,
        text: theme.colors.danger,
      };
    case 'warning':
      return {
        background: theme.colors.warningMuted,
        text: theme.colors.warning,
      };
    case 'primary':
      return {
        background: theme.colors.primaryMuted,
        text: theme.colors.primary,
      };
    case 'success':
      return {
        background: theme.colors.successMuted,
        text: theme.colors.success,
      };
    case 'neutral':
      return {
        background: theme.colors.surfaceMuted,
        text: theme.colors.textMuted,
      };
  }
}

/**
 * The worker's global sync state, below the connectivity banner on every screen: unsynced
 * changes, syncing, or changes that need attention. Hidden when everything is synced.
 */
export function SyncStatusBanner(): React.JSX.Element | null {
  const theme = useTheme();
  const offline = useOfflineJobs();
  const banner = describeSync(offline?.status ?? null);
  if (banner === null) {
    return null;
  }
  const { background, text } = colors(theme, banner.tone);
  return (
    <AppText
      variant="caption"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: background,
        color: text,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.xs,
      }}
    >
      {banner.message}
    </AppText>
  );
}
