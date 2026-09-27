import React, { forwardRef } from 'react';

import { TextField, type TextFieldHandle, type TextFieldProps } from '../ui';

export interface MoneyFieldProps
  extends Omit<TextFieldProps, 'keyboardType' | 'value' | 'onChangeText'> {
  /** What the person typed, for example "2,00,000" (parsed with parseMoney on submit). */
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly currency: string;
}

/**
 * An amount input: a decimal keyboard, digits, commas and one decimal point only. The form
 * keeps the text and converts it with parseMoney (@fieldops/shared/money) to minor units, so
 * no floating-point value ever reaches the server.
 */
export const MoneyField = forwardRef<TextFieldHandle, MoneyFieldProps>(
  function MoneyField({ value, onChangeText, currency, hint, ...rest }, ref) {
    return (
      <TextField
        ref={ref}
        {...rest}
        value={value}
        onChangeText={text => onChangeText(text.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        hint={hint ?? `In ${currency}.`}
      />
    );
  },
);
