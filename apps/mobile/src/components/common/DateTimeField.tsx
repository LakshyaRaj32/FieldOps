import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { useTheme } from '../../theme';
import { formatDateLabel, formatTimeLabel } from '../../utils/dateFormat';
import {
  AppText,
  Button,
  FieldLabel,
  FieldMessage,
  fieldColors,
  Icon,
  type FieldState,
} from '../ui';

export type DateTimeFieldMode = 'date' | 'time';

export interface DateTimeFieldProps {
  readonly label: string;
  readonly mode: DateTimeFieldMode;
  /** The current value; `date` mode uses its calendar day, `time` mode its hour and minute. */
  readonly value: Date;
  readonly onChange: (value: Date) => void;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly disabled?: boolean;
  readonly minimumDate?: Date;
  readonly maximumDate?: Date;
}

const LABELS: Readonly<
  Record<
    DateTimeFieldMode,
    { icon: 'calendar-outline' | 'time-outline'; hint: string }
  >
> = {
  date: { icon: 'calendar-outline', hint: 'Opens the date picker' },
  time: { icon: 'time-outline', hint: 'Opens the time picker' },
};

/**
 * A form field that opens the platform's date or time picker instead of asking for typed
 * text. Android shows the native dialog; iOS shows the native wheel in a sheet with Done.
 * The field only reports the picked Date; the form decides how to store it.
 */
export function DateTimeField({
  label,
  mode,
  value,
  onChange,
  error,
  hint,
  disabled = false,
  minimumDate,
  maximumDate,
}: DateTimeFieldProps): React.JSX.Element {
  const theme = useTheme();
  const [iosOpen, setIosOpen] = useState(false);
  const [iosDraft, setIosDraft] = useState(value);
  const display =
    mode === 'date' ? formatDateLabel(value) : formatTimeLabel(value);

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode,
        ...(minimumDate !== undefined && { minimumDate }),
        ...(maximumDate !== undefined && { maximumDate }),
        onChange: (event: DateTimePickerEvent, picked?: Date) => {
          if (event.type === 'set' && picked !== undefined) {
            onChange(picked);
          }
        },
      });
      return;
    }
    setIosDraft(value);
    setIosOpen(true);
  };

  return (
    <View style={{ gap: theme.spacing.xs + 2 }}>
      <FieldLabel label={label} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${display}`}
        accessibilityHint={error ?? LABELS[mode].hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={open}
        style={({ pressed }) => {
          const state: FieldState = disabled
            ? 'disabled'
            : error !== undefined
            ? 'error'
            : pressed
            ? 'focused'
            : 'idle';
          const colors = fieldColors(theme, state);
          return [
            styles.control,
            {
              minHeight: theme.controlHeights.md,
              borderColor: colors.border,
              backgroundColor: colors.background,
              borderRadius: theme.radii.md,
              paddingHorizontal: theme.spacing.md,
              gap: theme.spacing.sm,
            },
          ];
        }}
      >
        <AppText
          style={styles.value}
          tone={disabled ? 'muted' : 'default'}
          numberOfLines={1}
        >
          {display}
        </AppText>
        <Icon name={LABELS[mode].icon} tone={disabled ? 'subtle' : 'primary'} />
      </Pressable>
      <FieldMessage error={error} hint={hint} />

      {Platform.OS === 'ios' ? (
        <Modal
          visible={iosOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setIosOpen(false)}
        >
          <Pressable
            style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
            accessibilityLabel="Close picker"
            onPress={() => setIosOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                padding: theme.spacing.lg,
                gap: theme.spacing.md,
                borderTopLeftRadius: theme.radii.xl,
                borderTopRightRadius: theme.radii.xl,
              },
            ]}
          >
            <AppText variant="heading">{label}</AppText>
            <DateTimePicker
              value={iosDraft}
              mode={mode}
              display="spinner"
              {...(minimumDate !== undefined && { minimumDate })}
              {...(maximumDate !== undefined && { maximumDate })}
              onChange={(_event, picked) => {
                if (picked !== undefined) {
                  setIosDraft(picked);
                }
              }}
            />
            <Button
              label="Done"
              onPress={() => {
                setIosOpen(false);
                onChange(iosDraft);
              }}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  value: { flex: 1 },
  backdrop: { flex: 1 },
  sheet: { paddingBottom: 32 },
});
