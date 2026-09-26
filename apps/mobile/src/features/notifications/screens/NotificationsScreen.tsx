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
        description="Operational notifications arrive in Version 9."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
