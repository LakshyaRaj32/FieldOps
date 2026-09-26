import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '../theme';
import { ConfigurationErrorScreen } from './ConfigurationErrorScreen';
import { configResult } from './config';
import { RootNavigator } from './navigation/RootNavigator';
import { AppProviders } from './providers/AppProviders';

export default function App(): React.JSX.Element {
  if (!configResult.ok) {
    return (
      <SafeAreaProvider>
        <ThemeProvider>
          <ConfigurationErrorScreen errors={configResult.errors} />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
