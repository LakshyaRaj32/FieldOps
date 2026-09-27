import React, { useState } from 'react';
import { View } from 'react-native';

import { Button, TextField } from '../../../components/ui';
import { useTheme } from '../../../theme';

const MESSAGE_MAX_LENGTH = 2000;

/** Writes a job message. The caller decides how it is sent (outbox or online). */
export function MessageComposer({
  onSend,
  busy = false,
}: {
  readonly onSend: (body: string) => void;
  readonly busy?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();

  const send = () => {
    const body = text.trim();
    if (body === '') {
      setError('Write something first.');
      return;
    }
    if (body.length > MESSAGE_MAX_LENGTH) {
      setError(`Use at most ${MESSAGE_MAX_LENGTH} characters.`);
      return;
    }
    setError(undefined);
    setText('');
    onSend(body);
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <TextField
        label="Message"
        value={text}
        onChangeText={value => {
          setText(value);
          setError(undefined);
        }}
        error={error}
        multiline
        textAlignVertical="top"
        placeholder="Write to the job's worker and managers"
      />
      <Button
        label="Send message"
        variant="secondary"
        loading={busy}
        onPress={send}
      />
    </View>
  );
}
