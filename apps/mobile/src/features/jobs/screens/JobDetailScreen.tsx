import React from 'react';
import { Role } from '@fieldops/types';

import type { JobsScreenProps } from '../../../app/navigation/types';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { ManagerJobDetail } from '../components/ManagerJobDetail';
import { WorkerJobDetail } from '../components/WorkerJobDetail';

/**
 * One job. Workers see it from the phone's database and act on it offline; managers and
 * admins see it online. Either way, the buttons are exactly the actions allowed now.
 */
export function JobDetailScreen({
  navigation,
  route,
}: JobsScreenProps<'JobDetail'>): React.JSX.Element {
  const { jobId } = route.params;
  const isWorker = useAppSelector(selectSessionUser)?.role === Role.WORKER;

  if (isWorker) {
    return <WorkerJobDetail jobId={jobId} />;
  }
  return (
    <ManagerJobDetail
      jobId={jobId}
      onAssign={() => navigation.navigate('AssignWorker', { jobId })}
      onEdit={() => navigation.navigate('JobForm', { jobId })}
      onDeleted={() => navigation.goBack()}
    />
  );
}
