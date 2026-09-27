import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import {
  JobStatus,
  type OrderSummary,
  type PaymentRecord,
  type ShopAccount,
  type ShopAssignee,
} from '@fieldops/types';

import type { ShopsScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Badge,
  Button,
  Card,
  Screen,
  SectionTitle,
  Skeleton,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import { isOrganizationAdmin } from '../../auth/roles';
import { useListJobsInfiniteQuery } from '../../jobs/api/jobsApi';
import { JobCard } from '../../jobs/components/JobCard';
import {
  formatSchedule,
  fullName,
  money,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGES,
} from '../../jobs/presentation';
import { ROLE_LABELS } from '../../auth/roles';
import {
  useEndShopAssignmentMutation,
  useGetShopAccountQuery,
  useGetShopQuery,
} from '../api/shopsApi';
import {
  formatCalendarDate,
  ORDER_STATUS_BADGES,
  PAYMENT_STATE_BADGES,
} from '../presentation';

const ALL_STATUSES = Object.values(JobStatus);

/**
 * A shop: contact and location, what it owes (from orders and verified payments, computed by
 * the server), its orders, recent payments, operations and the people assigned to it.
 */
export function ShopDetailScreen({
  navigation,
  route,
}: ShopsScreenProps<'ShopDetail'>): React.JSX.Element {
  const theme = useTheme();
  const { shopId } = route.params;
  const admin = isOrganizationAdmin(useAppSelector(selectSessionUser));
  const shop = useGetShopQuery(shopId);
  const account = useGetShopAccountQuery(shopId);
  const operations = useListJobsInfiniteQuery({
    statuses: ALL_STATUSES,
    order: 'desc',
    limit: 10,
    shopId,
  });
  const [endAssignment, endState] = useEndShopAssignmentMutation();
  const [actionError, setActionError] = useState<AppError | undefined>();

  const refresh = () => {
    shop.refetch().catch(() => undefined);
    account.refetch().catch(() => undefined);
    operations.refetch().catch(() => undefined);
  };

  if (shop.data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {shop.isLoading ? (
          <LoadingState message="Loading shop…" />
        ) : (
          <ErrorState
            title="Couldn't load this shop"
            error={shop.error}
            onRetry={refresh}
          />
        )}
      </Screen>
    );
  }
  const detail = shop.data;
  const jobs = operations.data?.pages.flatMap(page => page.items) ?? [];

  const newOperation = () =>
    navigation.navigate('Jobs', {
      screen: 'JobForm',
      params: { shopId },
      initial: false,
    });

  const end = (person: ShopAssignee) => {
    setActionError(undefined);
    endAssignment({ shopId, userId: person.user.id })
      .unwrap()
      .catch((failure: unknown) => setActionError(toAppError(failure)));
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={
            (shop.isFetching || account.isFetching) &&
            !shop.isLoading &&
            !account.isLoading
          }
          onRefresh={refresh}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="title">{detail.name}</AppText>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Badge
            label={detail.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            tone={detail.status === 'ACTIVE' ? 'success' : 'neutral'}
            icon="storefront-outline"
          />
        </View>
      </View>

      {detail.status === 'ACTIVE' ? (
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Button
            label="New operation"
            icon="add-circle-outline"
            size="sm"
            onPress={newOperation}
          />
          <Button
            label="New order"
            icon="cart-outline"
            variant="secondary"
            size="sm"
            onPress={() => navigation.navigate('OrderForm', { shopId })}
          />
        </View>
      ) : null}

      <AccountCard
        account={account.data}
        loading={account.isLoading}
        error={account.error}
      />

      <Card>
        <SectionTitle
          title="Contact"
          icon="call-outline"
          {...(admin && {
            accessory: (
              <Button
                label="Edit"
                variant="ghost"
                size="sm"
                onPress={() => navigation.navigate('ShopForm', { shopId })}
              />
            ),
          })}
        />
        {detail.ownerName !== null ? (
          <InfoRow label="Owner" value={detail.ownerName} />
        ) : null}
        {detail.phone !== null ? (
          <InfoRow label="Phone" value={detail.phone} />
        ) : null}
        {detail.email !== null ? (
          <InfoRow label="Email" value={detail.email} />
        ) : null}
        <InfoRow label="Address" value={detail.address} />
        <InfoRow
          label="GPS"
          value={
            detail.location === null
              ? 'Not set: arrival distances cannot be checked.'
              : `${detail.location.latitude.toFixed(
                  5,
                )}, ${detail.location.longitude.toFixed(5)}`
          }
        />
      </Card>

      <OrdersCard
        orders={account.data?.orders ?? []}
        currency={account.data?.currency ?? 'INR'}
        loading={account.isLoading}
        onOpen={order =>
          navigation.navigate('OrderDetail', { orderId: order.id })
        }
      />

      <PaymentsCard
        payments={account.data?.recentPayments ?? []}
        currency={account.data?.currency ?? 'INR'}
      />

      <Card>
        <SectionTitle title="Operations" icon="briefcase-outline" />
        {operations.isLoading ? (
          <Skeleton height={56} radius="md" />
        ) : jobs.length === 0 ? (
          <AppText tone="muted">No operations at this shop yet.</AppText>
        ) : (
          jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              showAssignee
              dense
              onPress={() =>
                navigation.navigate('Jobs', {
                  screen: 'JobDetail',
                  params: { jobId: job.id },
                  initial: false,
                })
              }
            />
          ))
        )}
      </Card>

      <Card>
        <SectionTitle
          title="People"
          icon="people-outline"
          accessory={
            <Button
              label="Assign"
              variant="ghost"
              size="sm"
              onPress={() => navigation.navigate('ShopAssign', { shopId })}
            />
          }
        />
        {detail.managers.length === 0 && detail.workers.length === 0 ? (
          <AppText tone="muted">Nobody is assigned to this shop yet.</AppText>
        ) : null}
        {[...detail.managers, ...detail.workers].map(person => (
          <View
            key={person.user.id}
            style={[styles.row, styles.between, { gap: theme.spacing.sm }]}
          >
            <View style={styles.fill}>
              <AppText variant="bodyStrong">{fullName(person.user)}</AppText>
              <AppText variant="caption" tone="muted">
                {ROLE_LABELS[person.role]} · since{' '}
                {formatSchedule(person.startedAt)}
              </AppText>
            </View>
            <Button
              label="End"
              variant="ghost"
              size="sm"
              disabled={endState.isLoading}
              onPress={() => end(person)}
            />
          </View>
        ))}
        {actionError !== undefined ? (
          <ErrorState title="That didn't work" error={actionError} />
        ) : null}
      </Card>
    </Screen>
  );
}

function AccountCard({
  account,
  loading,
  error,
}: {
  readonly account: ShopAccount | undefined;
  readonly loading: boolean;
  readonly error: unknown;
}): React.JSX.Element {
  const theme = useTheme();
  if (account === undefined) {
    return (
      <Card>
        <SectionTitle title="Account" icon="wallet-outline" />
        {loading ? (
          <Skeleton height={72} radius="md" />
        ) : (
          <ErrorState title="Couldn't load the account" error={error} />
        )}
      </Card>
    );
  }
  const amount = (value: number) => money(value, account.currency);
  return (
    <Card>
      <SectionTitle title="Account" icon="wallet-outline" />
      <View
        accessible
        accessibilityLabel={`Outstanding ${amount(account.outstanding)}`}
      >
        <AppText variant="caption" tone="muted">
          Outstanding
        </AppText>
        <AppText variant="title">{amount(account.outstanding)}</AppText>
      </View>
      <View style={[styles.row, { gap: theme.spacing.lg }]}>
        <Figure
          label="Overdue"
          value={amount(account.overdue)}
          tone={account.overdue > 0 ? 'danger' : 'default'}
        />
        <Figure
          label="To verify"
          value={amount(account.pendingVerification)}
          tone={account.pendingVerification > 0 ? 'warning' : 'default'}
        />
      </View>
      <View style={[styles.row, { gap: theme.spacing.lg }]}>
        <Figure label="Ordered" value={amount(account.totalOrdered)} />
        <Figure label="Paid" value={amount(account.totalPaid)} tone="success" />
      </View>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'default' | 'danger' | 'warning' | 'success';
}): React.JSX.Element {
  return (
    <View
      style={styles.fill}
      accessible
      accessibilityLabel={`${label} ${value}`}
    >
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="bodyStrong" tone={tone}>
        {value}
      </AppText>
    </View>
  );
}

function OrdersCard({
  orders,
  currency,
  loading,
  onOpen,
}: {
  readonly orders: readonly OrderSummary[];
  readonly currency: string;
  readonly loading: boolean;
  readonly onOpen: (order: OrderSummary) => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Card>
      <SectionTitle title="Orders" icon="receipt-outline" />
      {loading ? (
        <Skeleton height={56} radius="md" />
      ) : orders.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No orders yet" />
      ) : (
        orders.map(order => {
          const status = ORDER_STATUS_BADGES[order.status];
          const paid = PAYMENT_STATE_BADGES[order.paymentState];
          return (
            <Pressable
              key={order.id}
              accessibilityRole="button"
              accessibilityLabel={`${order.orderNumber}, ${money(
                order.outstandingAmount,
                currency,
              )} outstanding of ${money(order.totalAmount, currency)}`}
              onPress={() => onOpen(order)}
              style={({ pressed }) => [
                styles.listRow,
                {
                  gap: theme.spacing.xs,
                  padding: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  backgroundColor: pressed
                    ? theme.colors.surfaceMuted
                    : theme.colors.background,
                },
              ]}
            >
              <View style={[styles.row, styles.between]}>
                <AppText variant="bodyStrong">{order.orderNumber}</AppText>
                <AppText variant="bodyStrong">
                  {money(order.totalAmount, currency)}
                </AppText>
              </View>
              <AppText variant="caption" tone="muted">
                Due {formatCalendarDate(order.dueDate)} ·{' '}
                {money(order.outstandingAmount, currency)} outstanding
              </AppText>
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                <Badge label={status.label} tone={status.tone} />
                {order.status !== 'CANCELLED' ? (
                  <Badge label={paid.label} tone={paid.tone} />
                ) : null}
                {order.isOverdue ? (
                  <Badge label="Overdue" tone="danger" icon="alarm-outline" />
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
    </Card>
  );
}

export function PaymentsCard({
  payments,
  currency,
  title = 'Recent payments',
}: {
  readonly payments: readonly PaymentRecord[];
  readonly currency: string;
  readonly title?: string;
}): React.JSX.Element | null {
  const theme = useTheme();
  return (
    <Card>
      <SectionTitle title={title} icon="cash-outline" />
      {payments.length === 0 ? (
        <AppText tone="muted">No payments recorded yet.</AppText>
      ) : (
        payments.map(payment => {
          const badge = PAYMENT_STATUS_BADGES[payment.status];
          return (
            <View key={payment.id} style={{ gap: theme.spacing.xxs }}>
              <View style={[styles.row, styles.between]}>
                <AppText variant="bodyStrong">
                  {money(payment.amount, currency)}
                </AppText>
                <Badge label={badge.label} tone={badge.tone} />
              </View>
              <AppText variant="caption" tone="muted">
                {PAYMENT_METHOD_LABELS[payment.method]}
                {payment.reference !== null
                  ? ` · ${payment.reference}`
                  : ''} · {fullName(payment.recordedBy)} ·{' '}
                {formatSchedule(payment.collectedAt)}
              </AppText>
              {payment.rejectionReason !== null ? (
                <AppText variant="caption" tone="danger">
                  Rejected: {payment.rejectionReason}
                </AppText>
              ) : null}
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  fill: { flex: 1 },
  listRow: {},
});
