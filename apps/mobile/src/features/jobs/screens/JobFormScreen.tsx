import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { JobPriority, type JobDetail } from '@fieldops/types';

import type { JobsScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Button,
  Card,
  Screen,
  SegmentedControl,
  TextField,
  type SegmentedOption,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import {
  useCreateJobMutation,
  useGetJobQuery,
  useUpdateJobMutation,
} from '../api/jobsApi';
import {
  canEditChecklist,
  emptyJobForm,
  jobToForm,
  toCreateJobRequest,
  toUpdateJobRequest,
  validateJobForm,
  type JobForm,
  type JobFormErrors,
} from '../jobForm';

const PRIORITY_OPTIONS: readonly SegmentedOption<JobPriority>[] = [
  { value: JobPriority.LOW, label: 'Low' },
  { value: JobPriority.NORMAL, label: 'Normal' },
  { value: JobPriority.HIGH, label: 'High' },
  { value: JobPriority.URGENT, label: 'Urgent' },
];

/** Create a job (no `jobId`) or edit one. Managers and admins only (enforced by the API). */
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
          <LoadingState message="Loading job…" />
        ) : (
          <ErrorState
            title="Couldn't load this job"
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
      onCreated={created => {
        // Create → choose the worker → back on the new job's details.
        navigation.replace('JobDetail', { jobId: created.id });
        navigation.navigate('AssignWorker', { jobId: created.id });
      }}
      onSaved={() => navigation.goBack()}
    />
  );
}

function JobFormContent({
  job,
  onCreated,
  onSaved,
}: {
  /** The job being edited (always the latest fetched version), or undefined to create. */
  readonly job: JobDetail | undefined;
  readonly onCreated: (job: JobDetail) => void;
  readonly onSaved: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  // Initialized once: a refetch after a conflict must not discard what the manager typed.
  const [form, setForm] = useState<JobForm>(() =>
    job === undefined ? emptyJobForm() : jobToForm(job),
  );
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [createJob, createState] = useCreateJobMutation();
  const [updateJob, updateState] = useUpdateJobMutation();
  const saving = createState.isLoading || updateState.isLoading;
  const checklistEditable = job === undefined || canEditChecklist(job.status);

  const update = (field: keyof JobForm) => (value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const submit = async () => {
    const validation = validateJobForm(form);
    setErrors(validation);
    setServerError(undefined);
    if (Object.keys(validation).length > 0 || saving) {
      return;
    }
    if (job === undefined) {
      const result = await createJob(toCreateJobRequest(form));
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
      <Card>
        <TextField
          label="Title"
          value={form.title}
          onChangeText={update('title')}
          error={errorFor('title')}
          placeholder="AC repair"
          editable={!saving}
        />
        <TextField
          label="Customer"
          value={form.customerName}
          onChangeText={update('customerName')}
          error={errorFor('customerName')}
          placeholder="ABC Ltd"
          editable={!saving}
        />
        <TextField
          label="Address"
          value={form.address}
          onChangeText={update('address')}
          error={errorFor('address')}
          placeholder="12 MG Road, Bengaluru"
          multiline
          editable={!saving}
        />
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View style={styles.fill}>
            <TextField
              label="Date"
              value={form.date}
              onChangeText={update('date')}
              error={errorFor('date', 'scheduledAt')}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              editable={!saving}
            />
          </View>
          <View style={styles.fill}>
            <TextField
              label="Time (24h)"
              value={form.time}
              onChangeText={update('time')}
              error={errorFor('time')}
              placeholder="HH:MM"
              keyboardType="numbers-and-punctuation"
              editable={!saving}
            />
          </View>
        </View>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="label" tone="muted">
            Priority
          </AppText>
          <SegmentedControl
            accessibilityLabel="Priority"
            options={PRIORITY_OPTIONS}
            value={form.priority}
            onChange={priority =>
              setForm(current => ({ ...current, priority }))
            }
          />
        </View>
      </Card>

      <Card>
        <TextField
          label="Description (optional)"
          value={form.description}
          onChangeText={update('description')}
          error={errorFor('description')}
          multiline
          textAlignVertical="top"
          editable={!saving}
        />
        <TextField
          label="Notes for the worker (optional)"
          value={form.notes}
          onChangeText={update('notes')}
          error={errorFor('notes')}
          multiline
          textAlignVertical="top"
          editable={!saving}
        />
        <TextField
          label="Checklist (one item per line, optional)"
          value={form.checklist}
          onChangeText={update('checklist')}
          error={errorFor('checklist')}
          multiline
          textAlignVertical="top"
          editable={!saving && checklistEditable}
        />
        {!checklistEditable ? (
          <AppText variant="caption" tone="muted">
            The checklist can't be changed after the job has started.
          </AppText>
        ) : null}
      </Card>

      {serverError !== undefined ? (
        <ErrorState
          title={
            job === undefined ? "Couldn't create the job" : "Couldn't save"
          }
          error={serverError}
        />
      ) : null}

      <Button
        label={job === undefined ? 'Create job' : 'Save changes'}
        onPress={() => {
          submit().catch(() => undefined);
        }}
        loading={saving}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
});
