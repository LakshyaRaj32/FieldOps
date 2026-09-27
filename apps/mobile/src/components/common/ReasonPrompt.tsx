import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, Button, TextField } from '../ui';

export interface ReasonRequest {
  readonly title: string;
  readonly placeholder: string;
  readonly required: boolean;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
}

/**
 * Asks for a short reason before an action that needs one (handing an operation back,
 * reporting a failure, sending a result back). A modal sheet with one text field; Android
 * Back and the backdrop cancel. The reason travels with the command; nothing is sent on
 * cancel.
 */
export function ReasonPrompt({
  request,
  onSubmit,
  onCancel,
}: {
  /** Null hides the prompt. */
  readonly request: ReasonRequest | null;
  readonly onSubmit: (reason: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (request !== null) {
      setReason('');
      setError(undefined);
    }
  }, [request]);

  const submit = () => {
    const text = reason.trim();
    if (request?.required === true && text === '') {
      setError('Give a reason.');
      return;
    }
    if (text.length > 500) {
      setError('Use at most 500 characters.');
      return;
    }
    onSubmit(text);
  };

  return (
    <Modal
      visible={request !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
        />
        <View
          style={[
            styles.sheet,
            theme.elevation.raised,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.lg,
              gap: theme.spacing.md,
              margin: theme.spacing.lg,
            },
          ]}
        >
          <AppText variant="heading">{request?.title}</AppText>
          <TextField
            label={request?.required === true ? 'Reason' : 'Reason (optional)'}
            value={reason}
            onChangeText={value => {
              setReason(value);
              setError(undefined);
            }}
            placeholder={request?.placeholder}
            error={error}
            multiline
            autoFocus
          />
          <View style={[styles.actions, { gap: theme.spacing.sm }]}>
            <Button label="Back" variant="ghost" onPress={onCancel} />
            <Button
              label={request?.confirmLabel ?? 'OK'}
              variant={request?.destructive === true ? 'danger' : 'primary'}
              onPress={submit}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center' },
  sheet: {},
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
