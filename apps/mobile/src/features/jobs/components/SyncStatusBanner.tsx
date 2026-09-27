import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Icon, type IconName } from '../../../components/ui';
import { useTheme, type AppTheme } from '../../../theme';
import {
  useOfflineJobs,
  useOfflineJobsUnavailable,
} from '../data/OfflineJobsContext';
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
    case 'info':
      return {
        background: theme.colors.infoMuted,
        text: theme.colors.info,
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

const ICONS: Readonly<Record<SyncBanner['tone'], IconName>> = {
  danger: 'alert-circle-outline',
  warning: 'cloud-offline-outline',
  primary: 'sync-outline',
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  neutral: 'time-outline',
};

/**
 * The worker's global sync state, below the connectivity banner on every screen: unsynced
 * changes, syncing, or changes that need attention. Hidden when everything is synced.
 */
export function SyncStatusBanner(): React.JSX.Element | null {
  const theme = useTheme();
  const offline = useOfflineJobs();
  const unavailable = useOfflineJobsUnavailable();
  const banner: SyncBanner | null = unavailable
    ? {
        message:
          "Your jobs can't be stored on this phone right now. Restart the app; if it keeps happening, contact support.",
        tone: 'danger',
      }
    : describeSync(offline?.status ?? null);
  if (banner === null) {
    return null;
  }
  const { background, text } = colors(theme, banner.tone);
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.row,
        {
          backgroundColor: background,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xs + 2,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <Icon name={ICONS[banner.tone]} size="sm" color={text} />
      <AppText variant="caption" style={[styles.message, { color: text }]}>
        {banner.message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  message: { flex: 1 },
});
