import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Product } from '@fieldops/types';

import type { ShopsScreenProps } from '../../../app/navigation/types';
import { DateTimeField } from '../../../components/common/DateTimeField';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import { currencyOf } from '../../auth/roles';
import { useListProductsQuery } from '../../catalog/api/catalogApi';
import { formatDateInput } from '../../jobs/jobForm';
import { money } from '../../jobs/presentation';
import { useCreateOrderMutation, useGetShopQuery } from '../api/shopsApi';
import { orderLines, parseQuantity } from '../orderForm';

const DAY = 86_400_000;

/**
 * A new order for a shop: quantities per product, and when payment is due. The total shown
 * is an estimate from the catalog; the server prices the order and computes the real total.
 */
export function OrderFormScreen({
  navigation,
  route,
}: ShopsScreenProps<'OrderForm'>): React.JSX.Element {
  const theme = useTheme();
  const { shopId } = route.params;
  const currency = currencyOf(useAppSelector(selectSessionUser));
  const shop = useGetShopQuery(shopId);
  const products = useListProductsQuery();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 30 * DAY));
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [createOrder, createState] = useCreateOrderMutation();

  if (products.data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {products.isLoading ? (
          <LoadingState message="Loading products…" />
        ) : (
          <ErrorState title="Couldn't load products" error={products.error} />
        )}
      </Screen>
    );
  }
  const catalog = products.data;
  const lines = orderLines(catalog, quantities);
  const estimate = lines.reduce(
    (sum, line) => sum + line.product.unitPrice * line.quantity,
    0,
  );

  const submit = async () => {
    setProblem(undefined);
    setServerError(undefined);
    if (
      Object.values(quantities).some(
        value => value.trim() !== '' && parseQuantity(value) === undefined,
      )
    ) {
      setProblem('Quantities must be whole numbers.');
      return;
    }
    if (lines.length === 0) {
      setProblem('Enter a quantity for at least one product.');
      return;
    }
    const result = await createOrder({
      shopId,
      items: lines.map(line => ({
        productId: line.product.id,
        quantity: line.quantity,
      })),
      dueDate: formatDateInput(dueDate),
      ...(notes.trim() !== '' && { notes: notes.trim() }),
    });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      navigation.replace('OrderDetail', { orderId: result.data.id });
    }
  };

  return (
    <Screen>
      <AppText variant="heading">{shop.data?.name ?? 'Shop'}</AppText>
      <Card>
        <SectionTitle title="Products" icon="pricetags-outline" />
        {catalog.length === 0 ? (
          <EmptyState
            icon="pricetags-outline"
            title="No products yet"
            description="Your organization admin adds products in Account › Products."
          />
        ) : (
          catalog.map((product: Product) => (
            <View
              key={product.id}
              style={[styles.row, { gap: theme.spacing.md }]}
            >
              <View style={styles.fill}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {product.name}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {product.sku} · {money(product.unitPrice, currency)} each
                </AppText>
              </View>
              <View style={styles.quantity}>
                <TextField
                  label="Qty"
                  value={quantities[product.id] ?? ''}
                  onChangeText={value =>
                    setQuantities(current => ({
                      ...current,
                      [product.id]: value.replace(/[^\d]/g, ''),
                    }))
                  }
                  keyboardType="number-pad"
                  placeholder="0"
                />
              </View>
            </View>
          ))
        )}
        {fieldError(serverError, 'items') !== undefined ? (
          <AppText tone="danger">{fieldError(serverError, 'items')}</AppText>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="Payment" icon="calendar-outline" />
        <DateTimeField
          label="Payment due"
          mode="date"
          value={dueDate}
          onChange={setDueDate}
          minimumDate={new Date()}
          error={fieldError(serverError, 'dueDate')}
        />
        <TextField
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        <View
          accessible
          accessibilityLabel={`Estimated total ${money(estimate, currency)}`}
        >
          <AppText variant="caption" tone="muted">
            Estimated total (the server prices the order)
          </AppText>
          <AppText variant="title">{money(estimate, currency)}</AppText>
        </View>
      </Card>

      {problem !== undefined ? (
        <AppText tone="danger" accessibilityRole="alert">
          {problem}
        </AppText>
      ) : null}
      {serverError !== undefined ? (
        <ErrorState title="Couldn't create the order" error={serverError} />
      ) : null}
      <Button
        label="Create order"
        icon="checkmark"
        loading={createState.isLoading}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  quantity: { width: 88 },
});
