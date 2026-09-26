import { useAppSelector } from '../store/hooks';
import {
  selectConnectivity,
  type ConnectivityState,
} from '../store/slices/connectivitySlice';

/** Current connectivity for components. Re-renders only when connectivity changes. */
export function useConnectivity(): ConnectivityState {
  return useAppSelector(selectConnectivity);
}
