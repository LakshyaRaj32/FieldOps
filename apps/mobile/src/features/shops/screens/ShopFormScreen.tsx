import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { skipToken } from '@reduxjs/toolkit/query/react';
import type { ShopDetail } from '@fieldops/types';

import type { ShopsScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
  ToggleRow,
} from '../../../components/ui';
import { describeLocationFailure } from '../../../services/location/locationResult';
import { getCurrentLocation } from '../../../services/location/locationService';
import { useTheme } from '../../../theme';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import {
  useCreateShopMutation,
  useGetShopQuery,
  useUpdateShopMutation,
} from '../api/shopsApi';
import {
  emptyShopForm,
  shopToForm,
  toCreateShopRequest,
  toUpdateShopRequest,
  validateShopForm,
  type ShopForm,
  type ShopFormErrors,
} from '../shopForm';

/** Create a shop (no `shopId`) or edit one. Organization admins (enforced by the API). */
export function ShopFormScreen({
  navigation,
  route,
}: ShopsScreenProps<'ShopForm'>): React.JSX.Element {
  const shopId = route.params?.shopId;
  const { data, error, isLoading, refetch } = useGetShopQuery(
    shopId ?? skipToken,
  );
  if (shopId !== undefined && data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading shop…" />
        ) : (
          <ErrorState
            title="Couldn't load this shop"
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
    <ShopFormContent
      shop={data}
      onSaved={saved =>
        shopId === undefined
          ? navigation.replace('ShopDetail', { shopId: saved.id })
          : navigation.goBack()
      }
    />
  );
}

function ShopFormContent({
  shop,
  onSaved,
}: {
  readonly shop: ShopDetail | undefined;
  readonly onSaved: (shop: ShopDetail) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [form, setForm] = useState<ShopForm>(() =>
    shop === undefined ? emptyShopForm() : shopToForm(shop),
  );
  const [errors, setErrors] = useState<ShopFormErrors>({});
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | undefined>();
  const [createShop, createState] = useCreateShopMutation();
  const [updateShop, updateState] = useUpdateShopMutation();
  const saving = createState.isLoading || updateState.isLoading;

  const update = (field: keyof ShopForm) => (value: string | boolean) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const fillMyPosition = async () => {
    setLocating(true);
    setLocationNotice(undefined);
    try {
      const result = await getCurrentLocation({ request: true });
      if (result.kind === 'ok') {
        setForm(current => ({
          ...current,
          latitude: result.location.latitude.toFixed(6),
          longitude: result.location.longitude.toFixed(6),
        }));
        setLocationNotice(
          `Position set (±${Math.round(
            result.location.accuracyMeters,
          )} m). Save to keep it.`,
        );
      } else {
        setLocationNotice(describeLocationFailure(result.kind).message);
      }
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    const validation = validateShopForm(form);
    setErrors(validation);
    setServerError(undefined);
    if (Object.keys(validation).length > 0 || saving) {
      return;
    }
    const result =
      shop === undefined
        ? await createShop(toCreateShopRequest(form))
        : await updateShop({
            id: shop.id,
            changes: toUpdateShopRequest(form, shop),
          });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      onSaved(result.data);
    }
  };

  const errorFor = (field: keyof ShopForm) =>
    errors[field] ?? fieldError(serverError, field);

  return (
    <Screen>
      <Card>
        <SectionTitle title="Shop" icon="storefront-outline" />
        <TextField
          label="Name"
          value={form.name}
          onChangeText={update('name')}
          error={errorFor('name')}
          placeholder="Nike Chandigarh"
          editable={!saving}
        />
        <TextField
          label="Address"
          value={form.address}
          onChangeText={update('address')}
          error={errorFor('address')}
          multiline
          editable={!saving}
        />
        {shop !== undefined ? (
          <ToggleRow
            label="Active"
            description="Inactive shops keep their history but take no new orders or operations."
            value={form.active}
            onChange={update('active')}
            disabled={saving}
          />
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="Contact (optional)" icon="call-outline" />
        <TextField
          label="Owner or contact"
          value={form.ownerName}
          onChangeText={update('ownerName')}
          error={errorFor('ownerName')}
          editable={!saving}
        />
        <TextField
          label="Phone"
          value={form.phone}
          onChangeText={update('phone')}
          error={errorFor('phone')}
          keyboardType="phone-pad"
          editable={!saving}
        />
        <TextField
          label="Email"
          value={form.email}
          onChangeText={update('email')}
          error={errorFor('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!saving}
        />
      </Card>

      <Card>
        <SectionTitle title="GPS location (optional)" icon="location-outline" />
        <AppText variant="caption" tone="muted">
          Used to show managers how far from the shop a worker reported
          arriving.
        </AppText>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View style={styles.fill}>
            <TextField
              label="Latitude"
              value={form.latitude}
              onChangeText={update('latitude')}
              error={errorFor('latitude')}
              keyboardType="numbers-and-punctuation"
              editable={!saving}
            />
          </View>
          <View style={styles.fill}>
            <TextField
              label="Longitude"
              value={form.longitude}
              onChangeText={update('longitude')}
              error={errorFor('longitude')}
              keyboardType="numbers-and-punctuation"
              editable={!saving}
            />
          </View>
        </View>
        <Button
          label="Use my current position"
          icon="locate-outline"
          variant="secondary"
          loading={locating}
          onPress={() => {
            fillMyPosition().catch(() => undefined);
          }}
        />
        {locationNotice !== undefined ? (
          <AppText variant="caption" tone="muted">
            {locationNotice}
          </AppText>
        ) : null}
      </Card>

      {serverError !== undefined ? (
        <ErrorState
          title={
            shop === undefined ? "Couldn't create the shop" : "Couldn't save"
          }
          error={serverError}
        />
      ) : null}
      <Button
        label={shop === undefined ? 'Create shop' : 'Save changes'}
        icon={shop === undefined ? 'add-circle-outline' : 'checkmark'}
        loading={saving}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
});
