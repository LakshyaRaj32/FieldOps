import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { needsPhoto } from '@fieldops/shared/requirements';
import {
  JobPriority,
  JobStatus,
  JobType,
  type JobDetail,
} from '@fieldops/types';

import type { JobsScreenProps } from '../../../app/navigation/types';
import { DateTimeField } from '../../../components/common/DateTimeField';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import { MoneyField } from '../../../components/common/MoneyField';
import {
  AppText,
  Button,
  Card,
  ChoiceChips,
  FieldLabel,
  FieldMessage,
  OptionList,
  Screen,
  SectionTitle,
  SegmentedControl,
  Skeleton,
  TextField,
  ToggleRow,
  type ChoiceOption,
  type SegmentedOption,
  type TextFieldHandle,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import { currencyOf } from '../../auth/roles';
import { useListProductsQuery } from '../../catalog/api/catalogApi';
import {
  useListOrdersQuery,
  useListShopsQuery,
} from '../../shops/api/shopsApi';
import { formatCalendarDate } from '../../shops/presentation';
import {
  useCreateJobMutation,
  useGetJobQuery,
  useUpdateJobMutation,
} from '../api/jobsApi';
import {
  canEditChecklist,
  emptyJobForm,
  formatDateInput,
  formatTimeInput,
  jobToForm,
  ORDER_TYPES,
  parseSchedule,
  toCreateJobRequest,
  toUpdateJobRequest,
  validateJobForm,
  type JobForm,
  type JobFormErrors,
} from '../jobForm';
import { money, TYPE_ICONS, TYPE_LABELS } from '../presentation';

const PRIORITY_OPTIONS: readonly SegmentedOption<JobPriority>[] = [
  { value: JobPriority.LOW, label: 'Low' },
  { value: JobPriority.NORMAL, label: 'Normal' },
  { value: JobPriority.HIGH, label: 'High' },
  { value: JobPriority.URGENT, label: 'Urgent' },
];

/** Business operations first; the general job (customer and address) last. */
const TYPE_OPTIONS: readonly ChoiceOption<JobType>[] = [
  JobType.PAYMENT_COLLECTION,
  JobType.DELIVERY,
  JobType.SHOP_VISIT,
  JobType.ORDER_COLLECTION,
  JobType.INVENTORY_CHECK,
  JobType.GENERAL,
].map(type => ({
  value: type,
  label: TYPE_LABELS[type],
  icon: TYPE_ICONS[type],
}));

/** A suggested title, until the person types their own. */
const DEFAULT_TITLES: Readonly<Record<JobType, string>> = {
  GENERAL: '',
  DELIVERY: 'Deliver the order',
  PAYMENT_COLLECTION: 'Collect payment',
  SHOP_VISIT: 'Routine inspection',
  ORDER_COLLECTION: 'Take a new order',
  INVENTORY_CHECK: 'Count stock',
};

/** Create an operation (no `jobId`) or edit one. Staff only (enforced by the API). */
export function JobFormScreen({
  navigation,
  route,
}: JobsScreenProps<'JobForm'>): React.JSX.Element {
  const jobId = route.params?.jobId;
  const {
    data: job,
    error,
    isLoading,
    refetch,
  } = useGetJobQuery(jobId ?? skipToken);

  if (jobId !== undefined && job === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading operation…" />
        ) : (
          <ErrorState
            title="Couldn't load this operation"
            error={error}
            onRetry={() => {
              refetch().catch(() => undefined);
            }}
          />
        )}
      </Screen>
    );
  }

  return (
    <JobFormContent
      job={job}
      preset={route.params}
      onCreated={created => {
        // Create → choose the worker → back on the new operation's details.
        navigation.replace('JobDetail', { jobId: created.id });
        navigation.navigate('AssignWorker', { jobId: created.id });
      }}
      onSaved={() => navigation.goBack()}
    />
  );
}

function JobFormContent({
  job,
  preset,
  onCreated,
  onSaved,
}: {
  /** The job being edited (always the latest fetched version), or undefined to create. */
  readonly job: JobDetail | undefined;
  readonly preset:
    | {
        readonly shopId?: string;
        readonly type?: JobType;
        readonly orderId?: string;
      }
    | undefined;
  readonly onCreated: (job: JobDetail) => void;
  readonly onSaved: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const currency = currencyOf(useAppSelector(selectSessionUser));
  // Initialized once: a refetch after a conflict must not discard what the manager typed.
  const [form, setForm] = useState<JobForm>(() => {
    if (job !== undefined) {
      return jobToForm(job);
    }
    const type =
      preset?.type ??
      (preset?.shopId !== undefined ? JobType.SHOP_VISIT : JobType.GENERAL);
    return {
      ...emptyJobForm(),
      type,
      title: DEFAULT_TITLES[type],
      shopId: preset?.shopId ?? '',
      orderId: preset?.orderId ?? '',
    };
  });
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [createJob, createState] = useCreateJobMutation();
  const [updateJob, updateState] = useUpdateJobMutation();
  const saving = createState.isLoading || updateState.isLoading;
  const creating = job === undefined;
  const general = form.type === JobType.GENERAL;
  const checklistEditable = creating || canEditChecklist(job.status);
  const scheduleEditable =
    creating || general || job.status === JobStatus.PENDING;
  const customerRef = useRef<TextFieldHandle>(null);
  const addressRef = useRef<TextFieldHandle>(null);
  // The pickers start from the form's schedule; the form keeps it as date and time text.
  const scheduled = parseSchedule(form.date, form.time) ?? new Date();

  const set = <K extends keyof JobForm>(field: K, value: JobForm[K]) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };
  const update = (field: keyof JobForm) => (value: string) =>
    set(field, value as never);

  const chooseType = (type: JobType) =>
    setForm(current => ({
      ...current,
      type,
      orderId: '',
      productIds: [],
      // Replace the suggested title only while it is still a suggestion.
      title: Object.values(DEFAULT_TITLES).includes(current.title)
        ? DEFAULT_TITLES[type]
        : current.title,
    }));

  const submit = async () => {
    const validation = validateJobForm(form, currency);
    setErrors(validation);
    setServerError(undefined);
    if (Object.keys(validation).length > 0 || saving) {
      return;
    }
    if (creating) {
      const result = await createJob(toCreateJobRequest(form, currency));
      if (result.error !== undefined) {
        setServerError(toAppError(result.error));
      } else {
        onCreated(result.data);
      }
      return;
    }
    const result = await updateJob({
      id: job.id,
      changes: toUpdateJobRequest(form, job),
    });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      onSaved();
    }
  };

  const errorFor = (field: keyof JobForm, apiField: string = field) =>
    errors[field] ?? fieldError(serverError, apiField);

  return (
    <Screen>
      {creating ? (
        <Card>
          <SectionTitle title="What needs doing?" icon="apps-outline" />
          <ChoiceChips
            accessibilityLabel="Operation type"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={chooseType}
            disabled={saving}
          />
        </Card>
      ) : null}

      {general ? (
        <Card>
          <SectionTitle title="Job" icon="briefcase-outline" />
          <TextField
            label="Title"
            value={form.title}
            onChangeText={update('title')}
            error={errorFor('title')}
            placeholder="AC repair"
            editable={!saving}
            returnKeyType="next"
            onSubmitEditing={() => customerRef.current?.focus()}
          />
          <TextField
            ref={customerRef}
            label="Customer"
            value={form.customerName}
            onChangeText={update('customerName')}
            error={errorFor('customerName')}
            placeholder="ABC Ltd"
            editable={!saving}
            returnKeyType="next"
            onSubmitEditing={() => addressRef.current?.focus()}
          />
          <TextField
            ref={addressRef}
            label="Address"
            value={form.address}
            onChangeText={update('address')}
            error={errorFor('address')}
            placeholder="12 MG Road, Bengaluru"
            multiline
            editable={!saving}
          />
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle
              title={TYPE_LABELS[form.type]}
              icon={TYPE_ICONS[form.type]}
            />
            <TextField
              label="Title"
              value={form.title}
              onChangeText={update('title')}
              error={errorFor('title')}
              editable={!saving}
            />
          </Card>
          {creating ? (
            <ShopPicker
              value={form.shopId}
              onChange={shopId => {
                set('shopId', shopId);
                set('orderId', '');
              }}
              error={errorFor('shopId')}
            />
          ) : (
            <Card>
              <SectionTitle title="Shop" icon="storefront-outline" />
              <InfoRow
                label="Shop"
                value={job.shop?.name ?? job.customerName}
              />
              {job.order !== null ? (
                <InfoRow label="Order" value={job.order.orderNumber} />
              ) : null}
              {job.expectedAmount !== null ? (
                <InfoRow
                  label="To collect"
                  value={money(job.expectedAmount, currency)}
                />
              ) : null}
              <AppText variant="caption" tone="muted">
                The shop, order and amount never change. Cancel the operation
                and create a new one instead.
              </AppText>
            </Card>
          )}
          {creating && ORDER_TYPES.includes(form.type) && form.shopId !== '' ? (
            <OrderPicker
              shopId={form.shopId}
              type={form.type}
              value={form.orderId}
              onChange={orderId => set('orderId', orderId)}
              error={errorFor('orderId')}
              currency={currency}
            />
          ) : null}
          {creating && form.type === JobType.PAYMENT_COLLECTION ? (
            <Card>
              <SectionTitle title="Amount to collect" icon="wallet-outline" />
              <MoneyField
                label="Amount"
                value={form.expectedAmount}
                onChangeText={update('expectedAmount')}
                currency={currency}
                error={errorFor('expectedAmount')}
                placeholder="2,00,000"
                editable={!saving}
              />
            </Card>
          ) : null}
          {creating && form.type === JobType.INVENTORY_CHECK ? (
            <ProductPicker
              value={form.productIds}
              onChange={ids => set('productIds', ids)}
              error={errorFor('productIds')}
              currency={currency}
            />
          ) : null}
          {creating ? (
            <Card>
              <SectionTitle title="Evidence" icon="camera-outline" />
              {needsPhoto(form.type, false) ? (
                <AppText tone="muted">
                  The worker must add at least one photo (
                  {form.type === JobType.DELIVERY
                    ? 'proof of delivery'
                    : 'the receipt'}
                  ) before submitting.
                </AppText>
              ) : (
                <ToggleRow
                  label="Ask for a photo"
                  description="The worker must add at least one photo before submitting."
                  value={form.requiresPhoto}
                  onChange={value => set('requiresPhoto', value)}
                  disabled={saving}
                />
              )}
            </Card>
          ) : null}
        </>
      )}

      <Card>
        <SectionTitle title="When" icon="calendar-outline" />
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View style={styles.fill}>
            <DateTimeField
              label="Date"
              mode="date"
              value={scheduled}
              onChange={date => update('date')(formatDateInput(date))}
              error={errorFor('date', 'scheduledAt')}
              disabled={saving || !scheduleEditable}
            />
          </View>
          <View style={styles.fill}>
            <DateTimeField
              label="Time"
              mode="time"
              value={scheduled}
              onChange={time => update('time')(formatTimeInput(time))}
              error={errorFor('time')}
              disabled={saving || !scheduleEditable}
            />
          </View>
        </View>
        {!scheduleEditable ? (
          <AppText variant="caption" tone="muted">
            Use Reschedule on the operation: the worker is told about the new
            time.
          </AppText>
        ) : null}
        <View style={{ gap: theme.spacing.xs + 2 }}>
          <FieldLabel label="Priority" />
          <SegmentedControl
            accessibilityLabel="Priority"
            options={PRIORITY_OPTIONS}
            value={form.priority}
            onChange={priority => set('priority', priority)}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle title="Instructions" icon="document-text-outline" />
        <TextField
          label="Description (optional)"
          value={form.description}
          onChangeText={update('description')}
          error={errorFor('description')}
          multiline
          editable={!saving}
        />
        <TextField
          label="Notes for the worker (optional)"
          value={form.notes}
          onChangeText={update('notes')}
          error={errorFor('notes')}
          multiline
          editable={!saving}
        />
        <TextField
          label={
            form.type === JobType.SHOP_VISIT
              ? 'Checklist'
              : 'Checklist (optional)'
          }
          value={form.checklist}
          onChangeText={update('checklist')}
          error={errorFor('checklist')}
          hint={
            checklistEditable
              ? 'One item per line, for example "Stock available?".'
              : "The checklist can't be changed once the worker has accepted."
          }
          multiline
          editable={!saving && checklistEditable}
        />
      </Card>

      {serverError !== undefined ? (
        <ErrorState
          title={creating ? "Couldn't create the operation" : "Couldn't save"}
          error={serverError}
        />
      ) : null}

      <Button
        label={
          creating
            ? `Create ${TYPE_LABELS[form.type].toLowerCase()}`
            : 'Save changes'
        }
        icon={creating ? 'add-circle-outline' : 'checkmark'}
        onPress={() => {
          submit().catch(() => undefined);
        }}
        loading={saving}
      />
    </Screen>
  );
}

function ShopPicker({
  value,
  onChange,
  error,
}: {
  readonly value: string;
  readonly onChange: (shopId: string) => void;
  readonly error: string | undefined;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const {
    data,
    isLoading,
    error: loadError,
  } = useListShopsQuery({
    search: search.trim(),
  });
  return (
    <Card>
      <SectionTitle title="Shop" icon="storefront-outline" />
      <TextField
        label="Search your shops"
        value={search}
        onChangeText={setSearch}
        placeholder="Shop name"
      />
      {isLoading ? (
        <Skeleton height={52} radius="md" />
      ) : loadError !== undefined ? (
        <ErrorState title="Couldn't load shops" error={loadError} />
      ) : (data ?? []).length === 0 ? (
        <AppText tone="muted">No shop found in your scope.</AppText>
      ) : (
        <OptionList
          accessibilityLabel="Shop"
          items={(data ?? []).slice(0, 20).map(shop => ({
            id: shop.id,
            title: shop.name,
            subtitle: shop.address,
          }))}
          selected={value === '' ? [] : [value]}
          onToggle={onChange}
        />
      )}
      <FieldMessage error={error} />
    </Card>
  );
}

function OrderPicker({
  shopId,
  type,
  value,
  onChange,
  error,
  currency,
}: {
  readonly shopId: string;
  readonly type: JobType;
  readonly value: string;
  readonly onChange: (orderId: string) => void;
  readonly error: string | undefined;
  readonly currency: string;
}): React.JSX.Element {
  const delivery = type === JobType.DELIVERY;
  const {
    data,
    isLoading,
    error: loadError,
  } = useListOrdersQuery({
    shopId,
    filter: delivery ? 'OPEN' : 'UNPAID',
  });
  const orders = data ?? [];
  const selected = orders.find(order => order.id === value);
  return (
    <Card>
      <SectionTitle title="Order" icon="receipt-outline" />
      {isLoading ? (
        <Skeleton height={52} radius="md" />
      ) : loadError !== undefined ? (
        <ErrorState title="Couldn't load orders" error={loadError} />
      ) : orders.length === 0 ? (
        <AppText tone="muted">
          {delivery
            ? 'This shop has no order left to deliver.'
            : 'This shop owes nothing on its orders.'}
        </AppText>
      ) : (
        <OptionList
          accessibilityLabel="Order"
          items={orders.map(order => ({
            id: order.id,
            title: order.orderNumber,
            subtitle: delivery
              ? `Ordered ${formatCalendarDate(order.orderDate)}`
              : `Due ${formatCalendarDate(order.dueDate)}${
                  order.isOverdue ? ' · overdue' : ''
                }`,
            trailing: delivery
              ? money(order.totalAmount, currency)
              : `${money(order.outstandingAmount, currency)} owed`,
          }))}
          selected={value === '' ? [] : [value]}
          onToggle={onChange}
        />
      )}
      {!delivery && selected !== undefined && selected.pendingAmount > 0 ? (
        <AppText variant="caption" tone="muted">
          {money(selected.pendingAmount, currency)} already collected and
          waiting for verification.
        </AppText>
      ) : null}
      <FieldMessage error={error} />
    </Card>
  );
}

function ProductPicker({
  value,
  onChange,
  error,
  currency,
}: {
  readonly value: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly error: string | undefined;
  readonly currency: string;
}): React.JSX.Element {
  const { data, isLoading, error: loadError } = useListProductsQuery();
  return (
    <Card>
      <SectionTitle title="Products to count" icon="pricetags-outline" />
      {isLoading ? (
        <Skeleton height={52} radius="md" />
      ) : loadError !== undefined ? (
        <ErrorState title="Couldn't load products" error={loadError} />
      ) : (
        <OptionList
          accessibilityLabel="Products to count"
          multiple
          items={(data ?? []).map(product => ({
            id: product.id,
            title: product.name,
            subtitle: product.sku,
            trailing: money(product.unitPrice, currency),
          }))}
          selected={value}
          onToggle={id =>
            onChange(
              value.includes(id)
                ? value.filter(existing => existing !== id)
                : [...value, id],
            )
          }
        />
      )}
      <FieldMessage error={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
});
