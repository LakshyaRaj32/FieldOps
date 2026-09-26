import React, { type PropsWithChildren } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as ReduxProvider } from 'react-redux';

import { ErrorBoundary } from '../../components/common/ErrorBoundary';
import { store } from '../../store';
import { ThemeProvider, useTheme } from '../../theme';
import { AppServices } from './AppServices';

function ThemedStatusBar(): React.JSX.Element {
  const theme = useTheme();
  return (
    <StatusBar
      barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
    />
  );
}

/**
 * App-wide providers, outermost first. The error boundary sits inside the theme provider so
 * its recovery screen is themed, and around everything that renders app content.
 */
export function AppProviders({
  children,
}: PropsWithChildren): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ReduxProvider store={store}>
        <ThemeProvider>
          <ThemedStatusBar />
          <ErrorBoundary>
            <AppServices />
            {children}
          </ErrorBoundary>
        </ThemeProvider>
      </ReduxProvider>
    </SafeAreaProvider>
  );
}
