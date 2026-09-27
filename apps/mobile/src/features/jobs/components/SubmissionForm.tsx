import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { minorDigits } from '@fieldops/shared/money';
import { needsPaymentReference } from '@fieldops/shared/requirements';
import {
  JobType,
  PaymentMethod,
  type JobDetail,
  type Product,
} from '@fieldops/types';

import { MoneyField } from '../../../components/common/MoneyField';
import {
  AppText,
  Button,
  Card,
  ChoiceChips,
  FieldLabel,
  Icon,
  SectionTitle,
  SegmentedControl,
  TextField,
  type ChoiceOption,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import { money, PAYMENT_METHOD_LABELS } from '../presentation';
import {
  buildSubmission,
  emptyDraft,
  type BuiltSubmission,
  type SubmissionDraft,
} from '../submission';

const METHOD_OPTIONS: readonly ChoiceOption<PaymentMethod>[] = Object.values(
  PaymentMethod,
).map(method => ({ value: method, label: PAYMENT_METHOD_LABELS[method] }));

type Answer = 'yes' | 'no' | 'unset';

/**
 * The worker's result for a field operation: checklist answers, delivered or counted
 * quantities, the products ordered or the payment collected, and a summary. It works fully
 * offline: what is still missing is listed with the server's own rules as the worker types,
 * and Submit is enabled only once nothing is.
 */
export function SubmissionForm({
  job,
  catalog,
  currency,
  busy,
  onSubmit,
}: {
  readonly job: JobDetail;
  readonly catalog: readonly Product[];
  readonly currency: string;
  readonly busy: boolean;
  readonly onSubmit: (built: BuiltSubmission) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [draft, setDraft] = useState<SubmissionDraft>(() =>
    emptyDraft(job, minorDigits(currency)),
  );
  const built = useMemo(
    () => buildSubmission(job, draft, catalog, currency),
    [job, draft, catalog, currency],
  );
  const set = <K extends keyof SubmissionDraft>(
    field: K,
    value: SubmissionDraft[K],
  ) => setDraft(current => ({ ...current, [field]: value }));
  const setIn = (
    field: 'answerNotes' | 'counts' | 'orderQuantities',
    id: string,
    value: string,
  ) =>
    setDraft(current => ({
      ...current,
      [field]: { ...current[field], [id]: value },
    }));

  const counting =
    job.type === JobType.DELIVERY || job.type === JobType.INVENTORY_CHECK;

  return (
    <Card>
      <SectionTitle title="Your result" icon="document-text-outline" />

      {job.checklist.map(item => {
        const answer: Answer =
          draft.answers[item.id] === undefined
            ? 'unset'
            : draft.answers[item.id] === true
            ? 'yes'
            : 'no';
        return (
          <View key={item.id} style={{ gap: theme.spacing.xs }}>
            <FieldLabel label={item.label} />
            <SegmentedControl
              accessibilityLabel={item.label}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={answer === 'unset' ? null : answer}
              onChange={value =>
                setDraft(current => ({
                  ...current,
                  answers: { ...current.answers, [item.id]: value === 'yes' },
                }))
              }
            />
            {answer === 'no' ? (
              <TextField
                label="What's wrong? (optional)"
                value={draft.answerNotes[item.id] ?? ''}
                onChangeText={value => setIn('answerNotes', item.id, value)}
              />
            ) : null}
          </View>
        );
      })}

      {counting
        ? job.lines.map(line => (
            <View key={line.id} style={[styles.row, { gap: theme.spacing.md }]}>
              <View style={styles.fill}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {line.productName}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {line.expectedQuantity === null
                    ? line.sku
                    : `${line.expectedQuantity} to deliver`}
                </AppText>
              </View>
              <View style={styles.quantity}>
                <TextField
                  label={
                    job.type === JobType.DELIVERY ? 'Delivered' : 'Counted'
                  }
                  value={draft.counts[line.id] ?? ''}
                  onChangeText={value =>
                    setIn('counts', line.id, value.replace(/[^\d]/g, ''))
                  }
                  keyboardType="number-pad"
                />
              </View>
            </View>
          ))
        : null}

      {job.type === JobType.ORDER_COLLECTION ? (
        catalog.length === 0 ? (
          <AppText tone="warning">
            The product list is not on this phone yet. Sync once while online.
          </AppText>
        ) : (
          catalog.map(product => (
            <View
              key={product.id}
              style={[styles.row, { gap: theme.spacing.md }]}
            >
              <View style={styles.fill}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {product.name}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {product.sku} · {money(product.unitPrice, currency)}
                </AppText>
              </View>
              <View style={styles.quantity}>
                <TextField
                  label="Qty"
                  value={draft.orderQuantities[product.id] ?? ''}
                  onChangeText={value =>
                    setIn(
                      'orderQuantities',
                      product.id,
                      value.replace(/[^\d]/g, ''),
                    )
                  }
                  keyboardType="number-pad"
                  placeholder="0"
                />
              </View>
            </View>
          ))
        )
      ) : null}

      {job.type === JobType.PAYMENT_COLLECTION ? (
        <View style={{ gap: theme.spacing.md }}>
          <MoneyField
            label="Amount collected"
            value={draft.amount}
            onChangeText={value => set('amount', value)}
            currency={currency}
            hint={
              job.expectedAmount === null
                ? undefined
                : `To collect: ${money(
                    job.expectedAmount,
                    currency,
                  )}. Only what you actually collected.`
            }
          />
          <View style={{ gap: theme.spacing.xs }}>
            <FieldLabel label="Paid by" />
            <ChoiceChips
              accessibilityLabel="Payment method"
              options={METHOD_OPTIONS}
              value={draft.method}
              onChange={method => set('method', method)}
            />
          </View>
          {needsPaymentReference(draft.method) ? (
            <TextField
              label="Transaction, UPI or cheque reference"
              value={draft.reference}
              onChangeText={value => set('reference', value)}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          ) : null}
        </View>
      ) : null}

      <TextField
        label="Summary (optional)"
        value={draft.note}
        onChangeText={value => set('note', value)}
        placeholder="Anything the manager should know"
        multiline
      />

      {built.problems.length > 0 ? (
        <View
          style={{ gap: theme.spacing.xs }}
          accessibilityLiveRegion="polite"
        >
          <AppText variant="captionStrong">Before you can submit:</AppText>
          {built.problems.map(problem => (
            <View
              key={`${problem.field}:${problem.message}`}
              style={[styles.row, { gap: theme.spacing.xs }]}
            >
              <Icon name="ellipse" size="sm" tone="warning" />
              <AppText variant="caption" style={styles.fill}>
                {problem.message}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <Button
        label="Submit for verification"
        icon="cloud-upload-outline"
        disabled={built.problems.length > 0}
        loading={busy}
        onPress={() => onSubmit(built)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  quantity: { width: 104 },
});
