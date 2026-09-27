import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { formatMoney, minorDigits, parseMoney } from '@fieldops/shared/money';
import type { Product } from '@fieldops/types';

import type { AccountScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import { MoneyField } from '../../../components/common/MoneyField';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
  ToggleRow,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import { currencyOf } from '../../auth/roles';
import {
  useCreateProductMutation,
  useListProductsQuery,
  useUpdateProductMutation,
} from '../../catalog/api/catalogApi';

/** Add a product or change one (the SKU never changes). ORGANIZATION_ADMIN only. */
export function ProductFormScreen({
  navigation,
  route,
}: AccountScreenProps<'ProductForm'>): React.JSX.Element {
  const productId = route.params?.productId;
  const { data, isLoading, error } = useListProductsQuery({ all: true });
  if (productId !== undefined && data === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading…" />
        ) : (
          <ErrorState title="Couldn't load the product" error={error} />
        )}
      </Screen>
    );
  }
  const product = data?.find(candidate => candidate.id === productId);
  return <ProductForm product={product} onDone={() => navigation.goBack()} />;
}

function ProductForm({
  product,
  onDone,
}: {
  readonly product: Product | undefined;
  readonly onDone: () => void;
}): React.JSX.Element {
  const currency = currencyOf(useAppSelector(selectSessionUser));
  const digits = minorDigits(currency);
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [price, setPrice] = useState(
    product === undefined ? '' : String(product.unitPrice / 10 ** digits),
  );
  const [archived, setArchived] = useState(product?.status === 'ARCHIVED');
  const [problem, setProblem] = useState<string | undefined>();
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [create, createState] = useCreateProductMutation();
  const [update, updateState] = useUpdateProductMutation();

  const submit = async () => {
    setProblem(undefined);
    setServerError(undefined);
    const unitPrice = parseMoney(price, currency);
    if (name.trim() === '' || (product === undefined && sku.trim() === '')) {
      setProblem('Enter the name and SKU.');
      return;
    }
    if (unitPrice === undefined) {
      setProblem('Enter the price.');
      return;
    }
    const result =
      product === undefined
        ? await create({
            name: name.trim(),
            sku: sku.trim(),
            unitPrice,
            ...(category.trim() !== '' && { category: category.trim() }),
          })
        : await update({
            id: product.id,
            changes: {
              name: name.trim(),
              category: category.trim() === '' ? null : category.trim(),
              unitPrice,
              status: archived ? 'ARCHIVED' : 'ACTIVE',
            },
          });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      onDone();
    }
  };

  return (
    <Screen>
      <Card>
        <SectionTitle title="Product" icon="pricetags-outline" />
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          error={fieldError(serverError, 'name')}
        />
        {product === undefined ? (
          <TextField
            label="SKU"
            value={sku}
            onChangeText={setSku}
            autoCapitalize="characters"
            autoCorrect={false}
            hint="Unique in your organization; it never changes."
            error={fieldError(serverError, 'sku')}
          />
        ) : (
          <InfoRow label="SKU" value={product.sku} />
        )}
        <TextField
          label="Category (optional)"
          value={category}
          onChangeText={setCategory}
        />
        <MoneyField
          label="Unit price"
          value={price}
          onChangeText={setPrice}
          currency={currency}
          hint={
            product === undefined
              ? undefined
              : `Now ${formatMoney(
                  product.unitPrice,
                  currency,
                )}. A new price applies to new orders only.`
          }
          error={fieldError(serverError, 'unitPrice')}
        />
        {product !== undefined ? (
          <ToggleRow
            label="Archived"
            description="Kept for old orders; can no longer be ordered, delivered or counted."
            value={archived}
            onChange={setArchived}
          />
        ) : null}
      </Card>
      {problem !== undefined ? (
        <AppText tone="danger" accessibilityRole="alert">
          {problem}
        </AppText>
      ) : null}
      {serverError !== undefined ? (
        <ErrorState title="Couldn't save the product" error={serverError} />
      ) : null}
      <Button
        label={product === undefined ? 'Add product' : 'Save changes'}
        icon="checkmark"
        loading={createState.isLoading || updateState.isLoading}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
