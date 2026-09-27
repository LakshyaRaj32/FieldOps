import React from 'react';
import { StyleSheet, View } from 'react-native';
import { needsPhoto } from '@fieldops/shared/requirements';
import { JobType, type JobDetail } from '@fieldops/types';

import { InfoRow } from '../../../components/common/InfoRow';
import {
  AppText,
  Badge,
  Card,
  Icon,
  SectionTitle,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  formatSchedule,
  fullName,
  money,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGES,
  TYPE_ICONS,
  TYPE_LABELS,
} from '../presentation';

/**
 * What an operation is about: its type, the shop (with a way to call it), the order and the
 * amount to collect, and what the worker must hand in. Nothing here is editable by the
 * worker: the manager set it, the server keeps it.
 */
export function OperationSummary({
  job,
  currency,
}: {
  readonly job: JobDetail;
  readonly currency: string;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (job.type === JobType.GENERAL) {
    return null;
  }
  const photo = needsPhoto(job.type, job.requiresPhoto);
  return (
    <Card>
      <SectionTitle title={TYPE_LABELS[job.type]} icon={TYPE_ICONS[job.type]} />
      {job.shop !== null ? (
        <InfoRow label="Shop" value={job.shop.name} />
      ) : null}
      {job.shop?.ownerName != null ? (
        <InfoRow label="Contact" value={job.shop.ownerName} />
      ) : null}
      {job.shop?.phone != null ? (
        <InfoRow label="Phone" value={job.shop.phone} />
      ) : null}
      {job.order !== null ? (
        <InfoRow label="Order" value={job.order.orderNumber} />
      ) : null}
      {job.expectedAmount !== null ? (
        <View
          accessible
          accessibilityLabel={`To collect ${money(
            job.expectedAmount,
            currency,
          )}`}
        >
          <AppText variant="caption" tone="muted">
            To collect
          </AppText>
          <AppText variant="title">
            {money(job.expectedAmount, currency)}
          </AppText>
        </View>
      ) : null}
      <InfoRow label="Responsible manager" value={fullName(job.manager)} />
      <View style={[styles.row, { gap: theme.spacing.xs }]}>
        {photo ? (
          <Badge label="Photo required" tone="info" icon="camera-outline" />
        ) : null}
        {job.checklist.length > 0 &&
        (job.type === JobType.SHOP_VISIT ||
          job.type === JobType.INVENTORY_CHECK) ? (
          <Badge
            label="Checklist required"
            tone="info"
            icon="checkbox-outline"
          />
        ) : null}
      </View>
      {job.submissionNote !== null ? (
        <InfoRow label="Worker's summary" value={job.submissionNote} />
      ) : null}
      {job.failureReason !== null ? (
        <InfoRow label="Could not be done because" value={job.failureReason} />
      ) : null}
    </Card>
  );
}

/** Product lines: to deliver, to count, or ordered, with what the worker reported. */
export function JobLines({
  job,
}: {
  readonly job: JobDetail;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (job.lines.length === 0) {
    return null;
  }
  const title =
    job.type === JobType.DELIVERY
      ? 'Items to deliver'
      : job.type === JobType.INVENTORY_CHECK
      ? 'Products to count'
      : 'Products ordered';
  return (
    <Card>
      <SectionTitle title={title} icon="cube-outline" />
      {job.lines.map(line => {
        const reported =
          line.quantity === null
            ? line.expectedQuantity === null
              ? 'Not counted yet'
              : `${line.expectedQuantity} to deliver`
            : line.expectedQuantity === null
            ? `${line.quantity}`
            : `${line.quantity} of ${line.expectedQuantity} delivered`;
        const short =
          line.quantity !== null &&
          line.expectedQuantity !== null &&
          line.quantity < line.expectedQuantity;
        return (
          <View
            key={line.id}
            style={[styles.row, styles.between, { gap: theme.spacing.sm }]}
          >
            <View style={styles.fill}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {line.productName}
              </AppText>
              <AppText variant="caption" tone="muted">
                {line.sku}
              </AppText>
            </View>
            <AppText variant="bodyStrong" tone={short ? 'warning' : 'default'}>
              {reported}
            </AppText>
          </View>
        );
      })}
    </Card>
  );
}

/** Payments recorded on the operation, with their verification status. */
export function JobPayments({
  job,
  currency,
}: {
  readonly job: JobDetail;
  readonly currency: string;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (job.payments.length === 0) {
    return null;
  }
  return (
    <Card>
      <SectionTitle title="Payment" icon="cash-outline" />
      {job.payments.map(payment => {
        const badge = PAYMENT_STATUS_BADGES[payment.status];
        return (
          <View key={payment.id} style={{ gap: theme.spacing.xxs }}>
            <View style={[styles.row, styles.between]}>
              <AppText variant="heading">
                {money(payment.amount, currency)}
              </AppText>
              <Badge label={badge.label} tone={badge.tone} />
            </View>
            <AppText variant="caption" tone="muted">
              {PAYMENT_METHOD_LABELS[payment.method]}
              {payment.reference !== null ? ` · ${payment.reference}` : ''} ·
              collected {formatSchedule(payment.collectedAt)}
            </AppText>
            {payment.verifiedBy !== null && payment.status === 'VERIFIED' ? (
              <AppText variant="caption" tone="success">
                Verified by {fullName(payment.verifiedBy)}
              </AppText>
            ) : null}
            {payment.rejectionReason !== null ? (
              <AppText variant="caption" tone="danger">
                Rejected: {payment.rejectionReason}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

/** A checklist item with the worker's answer, once there is one. */
export function ChecklistAnswerRow({
  label,
  checked,
  note,
}: {
  readonly label: string;
  readonly checked: boolean | null;
  readonly note: string | null;
}): React.JSX.Element {
  const theme = useTheme();
  const answer = checked === null ? 'Not answered' : checked ? 'Yes' : 'No';
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${answer}${
        note === null ? '' : `, ${note}`
      }`}
      style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}
    >
      <Icon
        name={
          checked === null
            ? 'ellipse-outline'
            : checked
            ? 'checkmark-circle'
            : 'close-circle'
        }
        size="md"
        tone={checked === null ? 'muted' : checked ? 'success' : 'danger'}
      />
      <View style={styles.fill}>
        <AppText>{label}</AppText>
        {note !== null ? (
          <AppText variant="caption" tone="muted">
            {note}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  fill: { flex: 1 },
});
