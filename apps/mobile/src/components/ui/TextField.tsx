import React, { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme, type AppTheme } from '../../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

/** What a TextField ref points to (the native text input), e.g. for `.focus()`. */
export type TextFieldHandle = React.ComponentRef<typeof TextInput>;

export interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  readonly label: string;
  /** Validation message shown under the field; also marks the field invalid. */
  readonly error?: string | undefined;
  /** Help shown under the field while there is no error. */
  readonly hint?: string | undefined;
}

export type FieldState = 'idle' | 'focused' | 'error' | 'disabled';

/** Border and fill of a form control in each state (shared with the picker fields). */
export function fieldColors(
  theme: AppTheme,
  state: FieldState,
): { border: string; background: string; text: string } {
  const { colors } = theme;
  switch (state) {
    case 'idle':
      return {
        border: colors.borderStrong,
        background: colors.surface,
        text: colors.text,
      };
    case 'focused':
      return {
        border: colors.primary,
        background: colors.surface,
        text: colors.text,
      };
    case 'error':
      return {
        border: colors.danger,
        background: colors.surface,
        text: colors.text,
      };
    case 'disabled':
      return {
        border: colors.border,
        background: colors.surfaceMuted,
        text: colors.textMuted,
      };
  }
}

/** The label above a form control. */
export function FieldLabel({
  label,
}: {
  readonly label: string;
}): React.JSX.Element {
  return <AppText variant="captionStrong">{label}</AppText>;
}

/** The line under a form control: the error (with an icon, not only red) or the hint. */
export function FieldMessage({
  error,
  hint,
}: {
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (error !== undefined) {
    return (
      <View style={[styles.message, { gap: theme.spacing.xs }]}>
        <Icon name="alert-circle" size="sm" tone="danger" />
        <AppText variant="caption" tone="danger" style={styles.messageText}>
          {error}
        </AppText>
      </View>
    );
  }
  if (hint !== undefined) {
    return (
      <AppText variant="caption" tone="muted">
        {hint}
      </AppText>
    );
  }
  return null;
}

/** Themed, labeled text input with focus, error and disabled states. */
export const TextField = forwardRef<TextFieldHandle, TextFieldProps>(
  function TextFieldInput(
    {
      label,
      error,
      hint,
      onFocus,
      onBlur,
      editable = true,
      multiline = false,
      returnKeyType,
      submitBehavior,
      ...inputProps
    },
    ref,
  ) {
    const theme = useTheme();
    const [focused, setFocused] = useState(false);
    const state: FieldState = !editable
      ? 'disabled'
      : error !== undefined
      ? 'error'
      : focused
      ? 'focused'
      : 'idle';
    const colors = fieldColors(theme, state);

    return (
      <View style={{ gap: theme.spacing.xs + 2 }}>
        <FieldLabel label={label} />
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          {...(error !== undefined && { accessibilityHint: error })}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={theme.colors.textMuted}
          editable={editable}
          multiline={multiline}
          {...(returnKeyType !== undefined && { returnKeyType })}
          // "Next" moves to the next field without closing and reopening the keyboard.
          submitBehavior={
            submitBehavior ??
            (multiline
              ? 'newline'
              : returnKeyType === 'next'
              ? 'submit'
              : 'blurAndSubmit')
          }
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
              color: colors.text,
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: theme.radii.md,
              paddingHorizontal: theme.spacing.md,
            },
            multiline ? styles.multiline : styles.singleLine,
          ]}
          {...inputProps}
        />
        <FieldMessage error={error} hint={hint} />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  input: { borderWidth: 1.5 },
  // 48 dp: the minimum touch target (theme.controlHeights.md).
  singleLine: { minHeight: 48, paddingVertical: 0 },
  multiline: { minHeight: 96, paddingVertical: 10, textAlignVertical: 'top' },
  message: { flexDirection: 'row', alignItems: 'flex-start' },
  messageText: { flex: 1 },
});
