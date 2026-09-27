import React, { useState } from 'react';

import type { PlatformScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
} from '../../../components/ui';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import { useCreateOrganizationMutation } from '../../organization/api/organizationApi';
import { validateMemberForm } from '../../organization/memberForm';

/**
 * A new organization with its first administrator, created together (SUPER_ADMIN). The
 * administrator signs in with the initial password and sets up people, shops and products.
 */
export function OrganizationFormScreen({
  navigation,
}: PlatformScreenProps<'OrganizationForm'>): React.JSX.Element {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [timeZone, setTimeZone] = useState('Asia/Kolkata');
  const [adminFirst, setAdminFirst] = useState('');
  const [adminLast, setAdminLast] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [create, state] = useCreateOrganizationMutation();

  const submit = async () => {
    setProblem(undefined);
    setServerError(undefined);
    if (name.trim() === '') {
      setProblem('Enter the organization name.');
      return;
    }
    const adminErrors = validateMemberForm({
      firstName: adminFirst,
      lastName: adminLast,
      email: adminEmail,
      password: adminPassword,
      role: 'ORGANIZATION_ADMIN',
      managerId: null,
      organizationWideAccess: false,
    });
    const firstProblem = Object.values(adminErrors)[0];
    if (firstProblem !== undefined) {
      setProblem(`Administrator: ${firstProblem}`);
      return;
    }
    const result = await create({
      name: name.trim(),
      ...(contactName.trim() !== '' && { contactName: contactName.trim() }),
      ...(contactPhone.trim() !== '' && { contactPhone: contactPhone.trim() }),
      currency: currency.trim().toUpperCase(),
      timeZone: timeZone.trim(),
      admin: {
        firstName: adminFirst.trim(),
        lastName: adminLast.trim(),
        email: adminEmail.trim(),
        password: adminPassword,
      },
    });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      navigation.goBack();
    }
  };

  return (
    <Screen>
      <Card>
        <SectionTitle title="Organization" icon="business-outline" />
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          error={fieldError(serverError, 'name')}
        />
        <TextField
          label="Contact person (optional)"
          value={contactName}
          onChangeText={setContactName}
        />
        <TextField
          label="Contact phone (optional)"
          value={contactPhone}
          onChangeText={setContactPhone}
          keyboardType="phone-pad"
        />
        <TextField
          label="Currency"
          value={currency}
          onChangeText={setCurrency}
          autoCapitalize="characters"
          maxLength={3}
          hint="ISO code, for example INR. Every amount of the organization uses it."
          error={fieldError(serverError, 'currency')}
        />
        <TextField
          label="Time zone"
          value={timeZone}
          onChangeText={setTimeZone}
          autoCapitalize="none"
          error={fieldError(serverError, 'timeZone')}
        />
      </Card>
      <Card>
        <SectionTitle title="First administrator" icon="shield-outline" />
        <TextField
          label="First name"
          value={adminFirst}
          onChangeText={setAdminFirst}
        />
        <TextField
          label="Last name"
          value={adminLast}
          onChangeText={setAdminLast}
        />
        <TextField
          label="Email"
          value={adminEmail}
          onChangeText={setAdminEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          error={fieldError(serverError, 'admin.email')}
        />
        <TextField
          label="Initial password"
          value={adminPassword}
          onChangeText={setAdminPassword}
          secureTextEntry
          autoCapitalize="none"
          hint="Share it privately; they can change it after signing in."
        />
      </Card>
      {problem !== undefined ? (
        <AppText tone="danger" accessibilityRole="alert">
          {problem}
        </AppText>
      ) : null}
      {serverError !== undefined ? (
        <ErrorState
          title="Couldn't create the organization"
          error={serverError}
        />
      ) : null}
      <Button
        label="Create organization"
        icon="checkmark"
        loading={state.isLoading}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
    </Screen>
  );
}
