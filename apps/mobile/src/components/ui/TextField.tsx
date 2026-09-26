import React, { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../../theme';
import { AppText } from './AppText';

/** What a TextField ref points to (the native text input), e.g. for `.focus()`. */
export type TextFieldHandle = React.ComponentRef<typeof TextInput>;

export interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  readonly label: string;
  /** Validation message shown under the field; also marks the field invalid. */
  readonly error?: string | undefined;
}

/** Themed, labeled text input with an inline error message. */
export const TextField = forwardRef<TextFieldHandle, TextFieldProps>(
  function TextFieldInput(
    { label, error, onFocus, onBlur, ...inputProps },
    ref,
  ) {
    const theme = useTheme();
    const [focused, setFocused] = useState(false);
    const borderColor =
      error !== undefined
        ? theme.colors.danger
        : focused
        ? theme.colors.primary
        : theme.colors.border;

    return (
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="label" tone="muted">
          {label}
        </AppText>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          {...(error !== undefined && { accessibilityHint: error })}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={event => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={event => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            theme.typography.body,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              borderColor,
              borderRadius: theme.radii.md,
              paddingHorizontal: theme.spacing.md,
            },
          ]}
          {...inputProps}
        />
        {error !== undefined ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1 },
});
