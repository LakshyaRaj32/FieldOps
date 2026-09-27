import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { skipToken } from '@reduxjs/toolkit/query/react';

import type { ShopsScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Card,
  OptionList,
  Screen,
  SectionTitle,
  type OptionItem,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { toAppError, type AppError } from '../../../utils/errors';
import { isOrganizationAdmin, ROLE_LABELS } from '../../auth/roles';
import { useListWorkersQuery } from '../../jobs/api/jobsApi';
import { fullName } from '../../jobs/presentation';
import { useListMembersQuery } from '../../organization/api/organizationApi';
import {
  useAssignToShopMutation,
  useEndShopAssignmentMutation,
  useGetShopQuery,
} from '../api/shopsApi';

/**
 * Who covers and serves the shop. Admins choose among the organization's managers and
 * workers; a manager among the workers of their team (the only people the server lets them
 * assign). Tapping a person assigns them, tapping again ends the assignment (kept as
 * history on the server).
 */
export function ShopAssignScreen({
  route,
}: ShopsScreenProps<'ShopAssign'>): React.JSX.Element {
  const { shopId } = route.params;
  const admin = isOrganizationAdmin(useAppSelector(selectSessionUser));
  const shop = useGetShopQuery(shopId);
  const members = useListMembersQuery(admin ? undefined : skipToken);
  const workers = useListWorkersQuery(admin ? skipToken : undefined);
  const [assign, assignState] = useAssignToShopMutation();
  const [end, endState] = useEndShopAssignmentMutation();
  const [error, setError] = useState<AppError | undefined>();

  if (shop.data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {shop.isLoading ? (
          <LoadingState message="Loading shop…" />
        ) : (
          <ErrorState title="Couldn't load this shop" error={shop.error} />
        )}
      </Screen>
    );
  }
  const assigned = [...shop.data.managers, ...shop.data.workers].map(
    person => person.user.id,
  );

  const people: OptionItem[] = admin
    ? (members.data ?? [])
        .filter(
          member =>
            member.isActive &&
            (member.role === 'MANAGER' || member.role === 'WORKER'),
        )
        .map(member => ({
          id: member.id,
          title: fullName(member),
          subtitle: ROLE_LABELS[member.role],
          icon: member.role === 'MANAGER' ? 'shield-outline' : 'person-outline',
        }))
    : (workers.data ?? []).map(worker => ({
        id: worker.id,
        title: fullName(worker),
        subtitle: 'Worker in your team',
        icon: 'person-outline' as const,
      }));
  const loading = admin ? members.isLoading : workers.isLoading;

  const toggle = (userId: string) => {
    setError(undefined);
    const request = assigned.includes(userId)
      ? end({ shopId, userId })
      : assign({ shopId, userId });
    request.unwrap().catch((failure: unknown) => setError(toAppError(failure)));
  };

  return (
    <Screen>
      <Card>
        <SectionTitle title={shop.data.name} icon="storefront-outline" />
        <AppText variant="caption" tone="muted">
          Managers assigned here cover the shop (they see it and its
          operations); workers assigned here serve it. Tap to assign, tap again
          to end.
        </AppText>
        {loading ? (
          <LoadingState message="Loading people…" />
        ) : people.length === 0 ? (
          <AppText tone="muted">Nobody to assign.</AppText>
        ) : (
          <OptionList
            items={people}
            selected={assigned}
            multiple
            onToggle={toggle}
            disabled={assignState.isLoading || endState.isLoading}
            accessibilityLabel="People assigned to the shop"
          />
        )}
        {error !== undefined ? (
          <ErrorState title="That didn't work" error={error} />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
