import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  ORGANIZATION_ROLES,
  Role,
  type Member,
  type OrganizationRole,
} from '@fieldops/types';

import type { AccountScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Button,
  Card,
  ChoiceChips,
  FieldLabel,
  OptionList,
  Screen,
  SectionTitle,
  TextField,
  ToggleRow,
  type ChoiceOption,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import { ROLE_LABELS } from '../../auth/roles';
import { fullName } from '../../jobs/presentation';
import {
  useCreateMemberMutation,
  useListMembersQuery,
  useSetMemberManagerMutation,
  useUpdateMemberMutation,
} from '../api/organizationApi';
import { validateMemberForm, type MemberForm } from '../memberForm';

const ROLE_OPTIONS: readonly ChoiceOption<OrganizationRole>[] =
  ORGANIZATION_ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }));

/**
 * Add a person to the organization (no `memberId`) or change one: role, team, access,
 * deactivation. ORGANIZATION_ADMIN only (enforced by the API).
 */
export function MemberFormScreen({
  navigation,
  route,
}: AccountScreenProps<'MemberForm'>): React.JSX.Element {
  const memberId = route.params?.memberId;
  const { data, error, isLoading } = useListMembersQuery();
  if (data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading…" />
        ) : (
          <ErrorState title="Couldn't load people" error={error} />
        )}
      </Screen>
    );
  }
  const member = data.find(candidate => candidate.id === memberId);
  const managers = data.filter(
    candidate => candidate.role === Role.MANAGER && candidate.isActive,
  );
  return memberId === undefined ? (
    <CreateMember managers={managers} onDone={() => navigation.goBack()} />
  ) : member === undefined ? (
    <Screen contentStyle={styles.centered}>
      <EmptyState
        icon="person-outline"
        title="Not found"
        description="This person isn't in your organization."
      />
    </Screen>
  ) : (
    <EditMember member={member} managers={managers} />
  );
}

function ManagerPicker({
  managers,
  value,
  onChange,
}: {
  readonly managers: readonly Member[];
  readonly value: string | null;
  readonly onChange: (managerId: string | null) => void;
}): React.JSX.Element {
  return managers.length === 0 ? (
    <AppText tone="muted">
      Add a manager first to put workers in a team.
    </AppText>
  ) : (
    <OptionList
      accessibilityLabel="Team manager"
      items={[
        { id: 'none', title: 'No team', icon: 'remove-circle-outline' },
        ...managers.map(manager => ({
          id: manager.id,
          title: fullName(manager),
          subtitle: manager.email,
          icon: 'shield-outline' as const,
        })),
      ]}
      selected={[value ?? 'none']}
      onToggle={id => onChange(id === 'none' ? null : id)}
    />
  );
}

function CreateMember({
  managers,
  onDone,
}: {
  readonly managers: readonly Member[];
  readonly onDone: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState<MemberForm>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: Role.WORKER,
    managerId: null,
    organizationWideAccess: false,
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof MemberForm, string>>
  >({});
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [create, state] = useCreateMemberMutation();

  const set = <K extends keyof MemberForm>(field: K, value: MemberForm[K]) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
  };

  const submit = async () => {
    const validation = validateMemberForm(form);
    setErrors(validation);
    setServerError(undefined);
    if (Object.keys(validation).length > 0) {
      return;
    }
    const result = await create({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      ...(form.role === Role.WORKER &&
        form.managerId !== null && { managerId: form.managerId }),
      ...(form.role === Role.MANAGER && {
        organizationWideAccess: form.organizationWideAccess,
      }),
    });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      onDone();
    }
  };
  const errorFor = (field: keyof MemberForm) =>
    errors[field] ?? fieldError(serverError, field);

  return (
    <Screen>
      <Card>
        <SectionTitle title="Person" icon="person-add-outline" />
        <TextField
          label="First name"
          value={form.firstName}
          onChangeText={value => set('firstName', value)}
          error={errorFor('firstName')}
        />
        <TextField
          label="Last name"
          value={form.lastName}
          onChangeText={value => set('lastName', value)}
          error={errorFor('lastName')}
        />
        <TextField
          label="Email"
          value={form.email}
          onChangeText={value => set('email', value)}
          error={errorFor('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="Initial password"
          value={form.password}
          onChangeText={value => set('password', value)}
          error={errorFor('password')}
          hint="At least 8 characters. Share it with them privately; they can change it after signing in."
          secureTextEntry
          autoCapitalize="none"
        />
      </Card>
      <Card>
        <SectionTitle title="Role" icon="shield-outline" />
        <ChoiceChips
          accessibilityLabel="Role"
          options={ROLE_OPTIONS}
          value={form.role}
          onChange={role => set('role', role)}
        />
        {form.role === Role.WORKER ? (
          <>
            <FieldLabel label="Team" />
            <ManagerPicker
              managers={managers}
              value={form.managerId}
              onChange={id => set('managerId', id)}
            />
          </>
        ) : null}
        {form.role === Role.MANAGER ? (
          <ToggleRow
            label="Organization-wide access"
            description="Sees every team, shop and operation, not only their own."
            value={form.organizationWideAccess}
            onChange={value => set('organizationWideAccess', value)}
          />
        ) : null}
      </Card>
      {serverError !== undefined ? (
        <ErrorState title="Couldn't add this person" error={serverError} />
      ) : null}
      <Button
        label="Add person"
        icon="checkmark"
        loading={state.isLoading}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
    </Screen>
  );
}

function EditMember({
  member,
  managers,
}: {
  readonly member: Member;
  readonly managers: readonly Member[];
}): React.JSX.Element {
  const me = useAppSelector(selectSessionUser);
  const self = me?.id === member.id;
  const [update, updateState] = useUpdateMemberMutation();
  const [setManager, managerState] = useSetMemberManagerMutation();
  const [error, setError] = useState<AppError | undefined>();
  const busy = updateState.isLoading || managerState.isLoading;

  const run = (request: Promise<unknown>) => {
    setError(undefined);
    request.catch((failure: unknown) => setError(toAppError(failure)));
  };

  return (
    <Screen>
      <Card>
        <SectionTitle title={fullName(member)} icon="person-outline" />
        <InfoRow label="Email" value={member.email} />
        <InfoRow label="Role" value={ROLE_LABELS[member.role]} />
      </Card>
      {!self ? (
        <Card>
          <SectionTitle title="Role and access" icon="shield-outline" />
          <ChoiceChips
            accessibilityLabel="Role"
            options={ROLE_OPTIONS}
            value={member.role as OrganizationRole}
            disabled={busy}
            onChange={role =>
              run(update({ id: member.id, changes: { role } }).unwrap())
            }
          />
          {member.role === Role.MANAGER ? (
            <ToggleRow
              label="Organization-wide access"
              description="Sees every team, shop and operation, not only their own."
              value={member.organizationWideAccess}
              disabled={busy}
              onChange={value =>
                run(
                  update({
                    id: member.id,
                    changes: { organizationWideAccess: value },
                  }).unwrap(),
                )
              }
            />
          ) : null}
          <ToggleRow
            label="Active"
            description="Deactivating signs them out everywhere and blocks sign-in. Their history stays."
            value={member.isActive}
            disabled={busy}
            onChange={value =>
              run(
                update({
                  id: member.id,
                  changes: { isActive: value },
                }).unwrap(),
              )
            }
          />
        </Card>
      ) : (
        <AppText tone="muted">
          You can't change your own role or deactivate yourself.
        </AppText>
      )}
      {member.role === Role.WORKER ? (
        <Card>
          <SectionTitle title="Team" icon="people-outline" />
          <ManagerPicker
            managers={managers}
            value={member.manager?.id ?? null}
            onChange={managerId =>
              run(setManager({ id: member.id, managerId }).unwrap())
            }
          />
          <AppText variant="caption" tone="muted">
            Moving a worker keeps the history of their earlier teams.
          </AppText>
        </Card>
      ) : null}
      {error !== undefined ? (
        <ErrorState title="That didn't work" error={error} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
