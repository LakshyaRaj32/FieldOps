import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import type { Organization } from '@fieldops/types';

import type { PlatformScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Badge,
  Button,
  Card,
  Screen,
  Skeleton,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import {
  useListOrganizationsQuery,
  useSetOrganizationSuspendedMutation,
} from '../../organization/api/organizationApi';

/**
 * The organizations using FieldOps (SUPER_ADMIN). The platform creates, suspends and
 * reactivates them; it does no field operations of its own.
 */
export function OrganizationsScreen({
  navigation,
}: PlatformScreenProps<'OrganizationList'>): React.JSX.Element {
  const theme = useTheme();
  const { data, error, isLoading, isFetching, refetch } =
    useListOrganizationsQuery();
  const [setSuspended, state] = useSetOrganizationSuspendedMutation();
  const [actionError, setActionError] = useState<AppError | undefined>();

  const toggle = (organization: Organization) => {
    const suspend = organization.status === 'ACTIVE';
    Alert.alert(
      suspend
        ? `Suspend ${organization.name}?`
        : `Reactivate ${organization.name}?`,
      suspend
        ? 'Its people can no longer sign in or use FieldOps. Nothing is deleted.'
        : 'Its people can sign in and work again.',
      [
        { text: 'Back', style: 'cancel' },
        {
          text: suspend ? 'Suspend' : 'Reactivate',
          style: suspend ? 'destructive' : 'default',
          onPress: () => {
            setActionError(undefined);
            setSuspended({ id: organization.id, suspended: suspend })
              .unwrap()
              .catch((failure: unknown) => setActionError(toAppError(failure)));
          },
        },
      ],
    );
  };

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={data ?? []}
        keyExtractor={organization => organization.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
        ListHeaderComponent={
          <View
            style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}
          >
            <Button
              label="New organization"
              icon="add-circle-outline"
              onPress={() => navigation.navigate('OrganizationForm')}
            />
            {actionError !== undefined ? (
              <ErrorState title="That didn't work" error={actionError} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Skeleton height={72} radius="md" />
          ) : error !== undefined ? (
            <ErrorState title="Couldn't load organizations" error={error} />
          ) : (
            <EmptyState
              icon="business-outline"
              title="No organizations yet"
              description="Create one with its first administrator; they set up the rest."
            />
          )
        }
        renderItem={({ item }) => (
          <Card padding="md" style={{ gap: theme.spacing.sm }}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <View style={styles.fill}>
                <AppText variant="bodyStrong">{item.name}</AppText>
                <AppText variant="caption" tone="muted">
                  {item.memberCount}{' '}
                  {item.memberCount === 1 ? 'person' : 'people'} ·{' '}
                  {item.currency} · {item.timeZone}
                </AppText>
              </View>
              <Badge
                label={item.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                tone={item.status === 'ACTIVE' ? 'success' : 'danger'}
              />
            </View>
            {item.contactName !== null || item.contactEmail !== null ? (
              <AppText variant="caption" tone="muted">
                {[item.contactName, item.contactEmail, item.contactPhone]
                  .filter(part => part !== null)
                  .join(' · ')}
              </AppText>
            ) : null}
            <Button
              label={item.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
              variant={item.status === 'ACTIVE' ? 'secondary' : 'primary'}
              size="sm"
              disabled={state.isLoading}
              onPress={() => toggle(item)}
            />
          </Card>
        )}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => {
              refetch().catch(() => undefined);
            }}
            colors={[theme.colors.primary]}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
});
