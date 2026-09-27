import React, { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Role, type Member } from '@fieldops/types';

import type { AccountScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  SegmentedControl,
  Skeleton,
  type SegmentedOption,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import { fullName } from '../../jobs/presentation';
import { useListMembersQuery } from '../api/organizationApi';

type Filter = 'WORKER' | 'MANAGER' | 'ORGANIZATION_ADMIN';

const FILTERS: readonly SegmentedOption<Filter>[] = [
  { value: 'WORKER', label: 'Workers' },
  { value: 'MANAGER', label: 'Managers' },
  { value: 'ORGANIZATION_ADMIN', label: 'Admins' },
];

/** The organization's people by role, with their team and access (ORGANIZATION_ADMIN). */
export function MembersScreen({
  navigation,
}: AccountScreenProps<'Members'>): React.JSX.Element {
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('WORKER');
  const { data, error, isLoading, isFetching, refetch } = useListMembersQuery();
  const members = (data ?? []).filter(member => member.role === filter);

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={members}
        keyExtractor={member => member.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
        ListHeaderComponent={
          <View
            style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}
          >
            <SegmentedControl
              accessibilityLabel="Role"
              options={FILTERS}
              value={filter}
              onChange={setFilter}
            />
            <Button
              label="Add a person"
              icon="person-add-outline"
              onPress={() => navigation.navigate('MemberForm')}
            />
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Skeleton height={60} radius="md" />
              <Skeleton height={60} radius="md" />
            </View>
          ) : error !== undefined ? (
            <ErrorState
              title="Couldn't load people"
              error={error}
              onRetry={() => {
                refetch().catch(() => undefined);
              }}
            />
          ) : (
            <EmptyState
              icon="people-outline"
              title="Nobody here yet"
              description="Add the people of your organization; they sign in with the password you give them."
            />
          )
        }
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            onPress={() =>
              navigation.navigate('MemberForm', { memberId: item.id })
            }
          />
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

function MemberRow({
  member,
  onPress,
}: {
  readonly member: Member;
  readonly onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const detail =
    member.role === Role.WORKER
      ? member.manager === null
        ? 'No team'
        : `Team of ${fullName(member.manager)}`
      : member.email;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${fullName(member)}, ${detail}${
        member.isActive ? '' : ', deactivated'
      }`}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card padding="md" style={[styles.row, { gap: theme.spacing.md }]}>
        <Icon
          name={
            member.role === Role.WORKER ? 'person-outline' : 'shield-outline'
          }
          size="md"
          tone="primary"
        />
        <View style={styles.fill}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {fullName(member)}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {detail}
          </AppText>
        </View>
        {!member.isActive ? <Badge label="Deactivated" tone="neutral" /> : null}
        {member.organizationWideAccess ? (
          <Badge label="All teams" tone="info" />
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  pressed: { opacity: 0.85 },
});
