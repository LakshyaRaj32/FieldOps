import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Role } from '@fieldops/types';

import { AssignWorkerScreen } from '../../features/jobs/screens/AssignWorkerScreen';
import { JobDetailScreen } from '../../features/jobs/screens/JobDetailScreen';
import { JobFormScreen } from '../../features/jobs/screens/JobFormScreen';
import { JobsScreen } from '../../features/jobs/screens/JobsScreen';
import { useAppSelector } from '../../store/hooks';
import { selectSessionUser } from '../../store/slices/sessionSlice';
import { renderScreenLayout } from './ScreenLayout';
import type { JobsStackParamList } from './types';

const Stack = createNativeStackNavigator<JobsStackParamList>();

/** The Jobs tab: list → details → (managers) create, edit and assign. */
export function JobsNavigator(): React.JSX.Element {
  const role = useAppSelector(selectSessionUser)?.role;
  return (
    <Stack.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={{ headerTitleStyle: { fontSize: 18, fontWeight: '700' } }}
    >
      <Stack.Screen
        name="JobList"
        component={JobsScreen}
        options={{ title: role === Role.WORKER ? 'My jobs' : 'Jobs' }}
      />
      <Stack.Screen
        name="JobDetail"
        component={JobDetailScreen}
        options={{ title: 'Job' }}
      />
      <Stack.Screen
        name="JobForm"
        component={JobFormScreen}
        options={({ route }) => ({
          title: route.params?.jobId === undefined ? 'New job' : 'Edit job',
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
