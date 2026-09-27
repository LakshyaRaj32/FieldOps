import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { Organization } from '@fieldops/types';

import type { AccountScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
} from '../../../components/ui';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import {
  useGetOwnOrganizationQuery,
  useUpdateOwnOrganizationMutation,
} from '../api/organizationApi';

/** The organization's profile and settings (ORGANIZATION_ADMIN edits them). */
export function OrganizationSettingsScreen(
  _props: AccountScreenProps<'OrganizationSettings'>,
): React.JSX.Element {
  const { data, error, isLoading } = useGetOwnOrganizationQuery();
  if (data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading…" />
        ) : (
          <ErrorState title="Couldn't load the organization" error={error} />
        )}
      </Screen>
    );
  }
  return <SettingsForm organization={data} />;
}

function SettingsForm({
  organization,
}: {
  readonly organization: Organization;
}): React.JSX.Element {
  const [name, setName] = useState(organization.name);
  const [contactName, setContactName] = useState(
    organization.contactName ?? '',
  );
  const [contactPhone, setContactPhone] = useState(
    organization.contactPhone ?? '',
  );
  const [contactEmail, setContactEmail] = useState(
    organization.contactEmail ?? '',
  );
  const [address, setAddress] = useState(organization.address ?? '');
  const [timeZone, setTimeZone] = useState(organization.timeZone);
  const [radius, setRadius] = useState(
    String(organization.arrivalRadiusMeters),
  );
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [update, state] = useUpdateOwnOrganizationMutation();
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

  const save = async () => {
    setSaved(false);
    setServerError(undefined);
    const result = await update({
      name: name.trim(),
      contactName: orNull(contactName),
      contactPhone: orNull(contactPhone),
      contactEmail: orNull(contactEmail),
      address: orNull(address),
      timeZone: timeZone.trim(),
      arrivalRadiusMeters: Number(radius),
    });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      setSaved(true);
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
        <InfoRow label="Currency" value={organization.currency} />
        <InfoRow label="People" value={String(organization.memberCount)} />
      </Card>
      <Card>
        <SectionTitle title="Contact" icon="call-outline" />
        <TextField
          label="Contact person"
          value={contactName}
          onChangeText={setContactName}
        />
        <TextField
          label="Phone"
          value={contactPhone}
          onChangeText={setContactPhone}
          keyboardType="phone-pad"
        />
        <TextField
          label="Email"
          value={contactEmail}
          onChangeText={setContactEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          error={fieldError(serverError, 'contactEmail')}
        />
        <TextField
          label="Address"
          value={address}
          onChangeText={setAddress}
          multiline
        />
      </Card>
      <Card>
        <SectionTitle title="Field settings" icon="options-outline" />
        <TextField
          label="Time zone"
          value={timeZone}
          onChangeText={setTimeZone}
          autoCapitalize="none"
          autoCorrect={false}
          hint='Decides "today" for due dates and daily figures, for example Asia/Kolkata.'
          error={fieldError(serverError, 'timeZone')}
        />
        <TextField
          label="Arrival radius (meters)"
          value={radius}
          onChangeText={value => setRadius(value.replace(/[^\d]/g, ''))}
          keyboardType="number-pad"
          hint="Arrivals reported farther than this from the shop are flagged to managers (never blocked). 10 to 50,000."
          error={fieldError(serverError, 'arrivalRadiusMeters')}
        />
      </Card>
      {serverError !== undefined ? (
        <ErrorState title="Couldn't save" error={serverError} />
      ) : null}
      {saved ? <AppText tone="success">Saved.</AppText> : null}
      <Button
        label="Save changes"
        icon="checkmark"
        loading={state.isLoading}
        onPress={() => {
          save().catch(() => undefined);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
