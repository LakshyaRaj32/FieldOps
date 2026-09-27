import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { useConnectivity } from '../../hooks/useConnectivity';
import { useTheme, type AppTheme } from '../../theme';
import { AppText, Icon, type IconName } from '../ui';

type BannerKind = 'offline' | 'reconnecting' | 'restored';

const RESTORED_VISIBLE_MS = 2500;

const ICONS: Readonly<Record<BannerKind, IconName>> = {
  offline: 'cloud-offline-outline',
  reconnecting: 'sync-outline',
  restored: 'checkmark-circle-outline',
};

const MESSAGES: Readonly<Record<BannerKind, string>> = {
  offline: "You're offline. Some features are unavailable until you reconnect.",
  reconnecting: 'Reconnecting…',
  restored: 'Back online',
};

function bannerColors(
  theme: AppTheme,
  kind: BannerKind,
): { background: string; text: string } {
  switch (kind) {
    case 'offline':
      return {
        background: theme.colors.warningMuted,
        text: theme.colors.warning,
      };
    case 'reconnecting':
      return {
        background: theme.colors.surfaceMuted,
        text: theme.colors.textMuted,
      };
    case 'restored':
      return {
        background: theme.colors.successMuted,
        text: theme.colors.success,
      };
  }
}

/**
 * Shows connectivity transitions: offline, reconnecting (connected but not yet verified) and a
 * short "Back online" confirmation. Nothing is shown in the normal online state.
 */
export function ConnectivityBanner(): React.JSX.Element | null {
  const theme = useTheme();
  const { status, recoveringFromOffline, restoredAt } = useConnectivity();
  const [dismissedRestoredAt, setDismissedRestoredAt] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (restoredAt === null) {
      return undefined;
    }
    const timer = setTimeout(
      () => setDismissedRestoredAt(restoredAt),
      RESTORED_VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [restoredAt]);

  let kind: BannerKind | null = null;
  if (status === 'offline') {
    kind = 'offline';
  } else if (recoveringFromOffline) {
    kind = 'reconnecting';
  } else if (
    status === 'online' &&
    restoredAt !== null &&
    restoredAt !== dismissedRestoredAt
  ) {
    kind = 'restored';
  }

  if (kind === null) {
    return null;
  }

  const colors = bannerColors(theme, kind);
  return (
    <Animated.View
      key={kind}
      entering={FadeInUp.duration(200)}
      exiting={FadeOutUp.duration(200)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.row,
        {
          backgroundColor: colors.background,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <Icon name={ICONS[kind]} size="sm" color={colors.text} />
      <AppText
        variant="caption"
        style={[styles.message, { color: colors.text }]}
      >
        {MESSAGES[kind]}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  message: { flex: 1, fontWeight: '600' },
});
