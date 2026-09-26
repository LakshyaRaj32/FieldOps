import React from 'react';
import { StyleSheet } from 'react-native';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { Screen } from '../../../components/ui';

export function NotificationsScreen(
  _props: AppTabScreenProps<'Notifications'>,
): React.JSX.Element {
  return (
    <Screen contentStyle={styles.centered}>
      <EmptyState
        title="You're all caught up"
        description="Job and message notifications arrive with Phase 4 (Field Operations)."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
