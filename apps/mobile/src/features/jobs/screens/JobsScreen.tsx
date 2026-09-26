import React from 'react';
import { StyleSheet } from 'react-native';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { Screen } from '../../../components/ui';

export function JobsScreen(
  _props: AppTabScreenProps<'Jobs'>,
): React.JSX.Element {
  return (
    <Screen contentStyle={styles.centered}>
      <EmptyState
        title="No jobs yet"
        description="Job lists, details and assignments arrive in Version 4, with offline access in Version 5."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
