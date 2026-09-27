import React, { type PropsWithChildren } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as ReduxProvider } from 'react-redux';

import { ErrorBoundary } from '../../components/common/ErrorBoundary';
import { OfflineJobsProvider } from '../../features/jobs/data/OfflineJobsProvider';
import { store } from '../../store';
import { ThemeProvider, useTheme } from '../../theme';
import { AppServices } from './AppServices';
import { PushNotifications } from './PushNotifications';
import { RealtimeConnection } from './RealtimeConnection';

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
            <OfflineJobsProvider>
              {/* Both refresh through the offline session, so they sit inside it. */}
              <RealtimeConnection>
                <PushNotifications>{children}</PushNotifications>
              </RealtimeConnection>
            </OfflineJobsProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </ReduxProvider>
    </SafeAreaProvider>
  );
}
