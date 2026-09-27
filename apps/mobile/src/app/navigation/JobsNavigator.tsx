import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { isStaff } from '../../features/auth/roles';
import { AssignWorkerScreen } from '../../features/jobs/screens/AssignWorkerScreen';
import { JobDetailScreen } from '../../features/jobs/screens/JobDetailScreen';
import { JobFormScreen } from '../../features/jobs/screens/JobFormScreen';
import { JobsScreen } from '../../features/jobs/screens/JobsScreen';
import { useAppSelector } from '../../store/hooks';
import { selectSessionUser } from '../../store/slices/sessionSlice';
import { useTheme } from '../../theme';
import { renderScreenLayout } from './ScreenLayout';
import { stackScreenOptions } from './stackOptions';
import type { JobsStackParamList } from './types';

const Stack = createNativeStackNavigator<JobsStackParamList>();

/** The Operations tab: list → details → (staff) create, edit and assign. */
export function JobsNavigator(): React.JSX.Element {
  const theme = useTheme();
  const staff = isStaff(useAppSelector(selectSessionUser));
  return (
    <Stack.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={stackScreenOptions(theme)}
    >
      <Stack.Screen
        name="JobList"
        component={JobsScreen}
        options={{ title: staff ? 'Operations' : 'My operations' }}
      />
      <Stack.Screen
        name="JobDetail"
        component={JobDetailScreen}
        options={{ title: 'Operation' }}
      />
      <Stack.Screen
        name="JobForm"
        component={JobFormScreen}
        options={({ route }) => ({
          title:
            route.params?.jobId === undefined
              ? 'New operation'
              : 'Edit operation',
        })}
      />
      <Stack.Screen
        name="AssignWorker"
        component={AssignWorkerScreen}
        options={{ title: 'Assign worker' }}
      />
    </Stack.Navigator>
  );
}
