import React, { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import type { Shop } from '@fieldops/types';

import type { ShopsScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  Skeleton,
  TextField,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { isOrganizationAdmin } from '../../auth/roles';
import { useListShopsQuery } from '../api/shopsApi';

/**
 * The shops in the user's scope (every shop for organization-wide staff, the shops a manager
 * covers otherwise: the server decides), searchable by name.
 */
export function ShopsScreen({
  navigation,
}: ShopsScreenProps<'ShopList'>): React.JSX.Element {
  const theme = useTheme();
  const admin = isOrganizationAdmin(useAppSelector(selectSessionUser));
  const [search, setSearch] = useState('');
  const { data, error, isLoading, isFetching, refetch } = useListShopsQuery({
    search: search.trim(),
    all: admin,
  });

  let empty: React.JSX.Element;
  if (isLoading) {
    empty = (
      <View style={{ gap: theme.spacing.sm }}>
        <Skeleton height={64} radius="md" />
        <Skeleton height={64} radius="md" />
        <Skeleton height={64} radius="md" />
      </View>
    );
  } else if (error !== undefined) {
    empty = (
      <ErrorState
        title="Couldn't load shops"
        error={error}
        onRetry={() => {
          refetch().catch(() => undefined);
        }}
      />
    );
  } else if (search.trim() !== '') {
    empty = (
      <EmptyState
        icon="search-outline"
        title="No shop matches"
        description="Try another part of the name."
      />
    );
  } else {
    empty = (
      <EmptyState
        icon="storefront-outline"
        title="No shops yet"
        description={
          admin
            ? 'Add the shops your teams serve.'
            : 'Your organization admin assigns the shops you cover.'
        }
        {...(admin && {
          actionLabel: 'Add a shop',
          actionIcon: 'add-circle-outline' as const,
          onAction: () => navigation.navigate('ShopForm'),
        })}
      />
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={data ?? []}
        keyExtractor={shop => shop.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
        ListHeaderComponent={
          <View
            style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}
          >
            <TextField
              label="Search"
              value={search}
              onChangeText={setSearch}
              placeholder="Shop name"
              autoCorrect={false}
              returnKeyType="search"
            />
            {admin ? (
              <Button
                label="New shop"
                icon="add-circle-outline"
                onPress={() => navigation.navigate('ShopForm')}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <ShopRow
            shop={item}
            onPress={() =>
              navigation.navigate('ShopDetail', { shopId: item.id })
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

function ShopRow({
  shop,
  onPress,
}: {
  readonly shop: Shop;
  readonly onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${shop.name}, ${shop.address}${
        shop.status === 'INACTIVE' ? ', inactive' : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card padding="md" style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.mark,
            {
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.primaryMuted,
            },
          ]}
        >
          <Icon name="storefront-outline" size="md" tone="primary" />
        </View>
        <View style={styles.fill}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {shop.name}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {shop.address}
          </AppText>
        </View>
        {shop.status === 'INACTIVE' ? (
          <Badge label="Inactive" tone="neutral" />
        ) : (
          <Icon name="chevron-forward" size="md" tone="muted" />
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  mark: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { flex: 1 },
  pressed: { opacity: 0.85 },
});
