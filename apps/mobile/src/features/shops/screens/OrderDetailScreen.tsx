import React, { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import type { ShopsScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import { ReasonPrompt } from '../../../components/common/ReasonPrompt';
import {
  AppText,
  Badge,
  Button,
  Card,
  Screen,
  SectionTitle,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import { currencyOf } from '../../auth/roles';
import { fullName, money } from '../../jobs/presentation';
import { useCancelOrderMutation, useGetOrderQuery } from '../api/shopsApi';
import {
  formatCalendarDate,
  ORDER_STATUS_BADGES,
  PAYMENT_STATE_BADGES,
} from '../presentation';
import { PaymentsCard } from './ShopDetailScreen';

/**
 * An order: its items (with delivered quantities), what is paid and outstanding (from
 * verified payments), every payment recorded against it, and the next steps (a delivery or
 * a collection), or cancelling it while nothing has happened to it.
 */
export function OrderDetailScreen({
  navigation,
  route,
}: ShopsScreenProps<'OrderDetail'>): React.JSX.Element {
  const theme = useTheme();
  const currency = currencyOf(useAppSelector(selectSessionUser));
  const {
    data: order,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetOrderQuery(route.params.orderId);
  const [cancel, cancelState] = useCancelOrderMutation();
  const [asking, setAsking] = useState(false);
  const [actionError, setActionError] = useState<AppError | undefined>();

  if (order === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading order…" />
        ) : (
          <ErrorState
            title="Couldn't load this order"
            error={error}
            onRetry={() => {
              refetch().catch(() => undefined);
            }}
          />
        )}
      </Screen>
    );
  }
  const status = ORDER_STATUS_BADGES[order.status];
  const paid = PAYMENT_STATE_BADGES[order.paymentState];
  const open = order.status !== 'CANCELLED';
  const undelivered = order.items.some(
    item => item.deliveredQuantity < item.quantity,
  );
  const collectable = order.outstandingAmount - order.pendingAmount > 0;
  const untouched =
    order.paidAmount === 0 &&
    order.pendingAmount === 0 &&
    order.items.every(item => item.deliveredQuantity === 0);

  const operation = (type: 'DELIVERY' | 'PAYMENT_COLLECTION') =>
    navigation.navigate('Jobs', {
      screen: 'JobForm',
      params: { shopId: order.shop.id, type, orderId: order.id },
      initial: false,
    });

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={() => {
            refetch().catch(() => undefined);
          }}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="title">{order.orderNumber}</AppText>
        <AppText tone="muted">{order.shop.name}</AppText>
        <View style={[styles.row, { gap: theme.spacing.xs }]}>
          <Badge label={status.label} tone={status.tone} />
          {open ? <Badge label={paid.label} tone={paid.tone} /> : null}
          {order.isOverdue ? (
            <Badge label="Overdue" tone="danger" icon="alarm-outline" />
          ) : null}
        </View>
      </View>

      <Card>
        <SectionTitle title="Money" icon="wallet-outline" />
        <InfoRow label="Total" value={money(order.totalAmount, currency)} />
        <InfoRow
          label="Paid (verified)"
          value={money(order.paidAmount, currency)}
        />
        <InfoRow
          label="Outstanding"
          value={money(order.outstandingAmount, currency)}
        />
        {order.pendingAmount > 0 ? (
          <InfoRow
            label="Collected, waiting for verification"
            value={money(order.pendingAmount, currency)}
          />
        ) : null}
        <InfoRow label="Ordered" value={formatCalendarDate(order.orderDate)} />
        <InfoRow
          label="Payment due"
          value={formatCalendarDate(order.dueDate)}
        />
        <InfoRow label="Created by" value={fullName(order.createdBy)} />
        {order.notes !== null ? (
          <InfoRow label="Notes" value={order.notes} />
        ) : null}
        {order.cancellationReason !== null ? (
          <InfoRow label="Cancelled because" value={order.cancellationReason} />
        ) : null}
      </Card>

      {open && (undelivered || collectable) ? (
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          {undelivered ? (
            <Button
              label="Plan delivery"
              icon="cube-outline"
              size="sm"
              onPress={() => operation('DELIVERY')}
            />
          ) : null}
          {collectable ? (
            <Button
              label="Collect payment"
              icon="wallet-outline"
              size="sm"
              variant="secondary"
              onPress={() => operation('PAYMENT_COLLECTION')}
            />
          ) : null}
        </View>
      ) : null}

      <Card>
        <SectionTitle title="Items" icon="cube-outline" />
        {order.items.map(item => (
          <View key={item.id} style={{ gap: theme.spacing.xxs }}>
            <View style={[styles.row, styles.between]}>
              <AppText
                variant="bodyStrong"
                style={styles.fill}
                numberOfLines={1}
              >
                {item.productName}
              </AppText>
              <AppText variant="bodyStrong">
                {money(item.lineTotal, currency)}
              </AppText>
            </View>
            <AppText variant="caption" tone="muted">
              {item.quantity} × {money(item.unitPrice, currency)} · delivered{' '}
              {item.deliveredQuantity} of {item.quantity}
            </AppText>
          </View>
        ))}
      </Card>

      <PaymentsCard
        payments={order.payments}
        currency={currency}
        title="Payments"
      />

      {open && untouched ? (
        <Button
          label="Cancel order"
          icon="close-circle-outline"
          variant="danger"
          loading={cancelState.isLoading}
          onPress={() => setAsking(true)}
        />
      ) : null}
      {actionError !== undefined ? (
        <ErrorState title="That didn't work" error={actionError} />
      ) : null}

      <ReasonPrompt
        request={
          asking
            ? {
                title: 'Why cancel this order?',
                placeholder: 'For example: entered twice',
                required: true,
                confirmLabel: 'Cancel order',
                destructive: true,
              }
            : null
        }
        onCancel={() => setAsking(false)}
        onSubmit={reason => {
          setAsking(false);
          setActionError(undefined);
          cancel({ id: order.id, shopId: order.shop.id, reason })
            .unwrap()
            .catch((failure: unknown) => setActionError(toAppError(failure)));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  fill: { flex: 1 },
});
