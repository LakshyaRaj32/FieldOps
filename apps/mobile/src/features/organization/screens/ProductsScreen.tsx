import React from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import type { AccountScreenProps } from '../../../app/navigation/types';
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
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { currencyOf } from '../../auth/roles';
import { useListProductsQuery } from '../../catalog/api/catalogApi';
import { money } from '../../jobs/presentation';

/** The organization's catalog, archived products included (ORGANIZATION_ADMIN). */
export function ProductsScreen({
  navigation,
}: AccountScreenProps<'Products'>): React.JSX.Element {
  const theme = useTheme();
  const currency = currencyOf(useAppSelector(selectSessionUser));
  const { data, error, isLoading, isFetching, refetch } = useListProductsQuery({
    all: true,
  });

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={data ?? []}
        keyExtractor={product => product.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
        ListHeaderComponent={
          <Button
            label="New product"
            icon="add-circle-outline"
            onPress={() => navigation.navigate('ProductForm')}
            style={{ marginBottom: theme.spacing.xs }}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <Skeleton height={60} radius="md" />
          ) : error !== undefined ? (
            <ErrorState title="Couldn't load products" error={error} />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title="No products yet"
              description="Products are what shops order, what gets delivered and what workers count."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.sku}, ${money(
              item.unitPrice,
              currency,
            )}`}
            onPress={() =>
              navigation.navigate('ProductForm', { productId: item.id })
            }
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card padding="md" style={[styles.row, { gap: theme.spacing.md }]}>
              <View style={styles.fill}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {item.name}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {item.sku}
                  {item.category !== null ? ` · ${item.category}` : ''}
                </AppText>
              </View>
              {item.status === 'ARCHIVED' ? (
                <Badge label="Archived" tone="neutral" />
              ) : null}
              <AppText variant="bodyStrong">
                {money(item.unitPrice, currency)}
              </AppText>
            </Card>
          </Pressable>
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
  pressed: { opacity: 0.85 },
});
