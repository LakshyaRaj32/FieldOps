import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import type { JobDetail } from '@fieldops/types';

import { InfoRow } from '../../../components/common/InfoRow';
import {
  AppText,
  Badge,
  Button,
  Card,
  type BadgeTone,
} from '../../../components/ui';
import { openInMaps } from '../../../services/location/locationService';
import { useTheme } from '../../../theme';
import {
  describeActionLocation,
  formatSchedule,
  fullName,
} from '../presentation';

/**
 * Job sections added in Phase 4 (location, photos, messages), shared by the worker's offline
 * screen and the manager's online screen. Presentational only: data and commands come from
 * the caller.
 */

/** The job site, with "Open in maps", and an optional slot for the worker's distance. */
export function JobSiteCard({
  job,
  children,
}: {
  readonly job: JobDetail;
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const { location } = job;
  return (
    <Card>
      <AppText variant="label" tone="muted">
        Job site
      </AppText>
      <InfoRow label="Address" value={job.address} />
      {location !== null ? (
        <View style={{ gap: theme.spacing.sm }}>
          <InfoRow
            label="Coordinates"
            value={`${location.latitude.toFixed(5)}, ${location.longitude.toFixed(
              5,
            )}`}
          />
          <Button
            label="Open in maps"
            variant="secondary"
            onPress={() => openInMaps(location, job.title)}
          />
        </View>
      ) : (
        <AppText variant="caption" tone="muted">
          This job has no map position, so distances can't be shown.
        </AppText>
      )}
      {children}
    </Card>
  );
}

/** Where the worker started and completed the job (recorded from their phone). */
export function JobVisitLocations({
  job,
}: {
  readonly job: JobDetail;
}): React.JSX.Element | null {
  const { startLocation, completeLocation } = job;
  if (startLocation === null && completeLocation === null) {
    return null;
  }
  return (
    <Card>
      <AppText variant="label" tone="muted">
        Visit
      </AppText>
      {startLocation !== null ? (
        <InfoRow
          label={`Started · ${formatSchedule(startLocation.capturedAt)}`}
          value={describeActionLocation(startLocation)}
        />
      ) : null}
      {completeLocation !== null ? (
        <InfoRow
          label={`Completed · ${formatSchedule(completeLocation.capturedAt)}`}
          value={describeActionLocation(completeLocation)}
        />
      ) : null}
      <AppText variant="caption" tone="muted">
        Positions come from the worker's phone and can be off by the accuracy shown.
      </AppText>
    </Card>
  );
}

export interface GalleryItem {
  readonly id: string;
  readonly source: ImageSourcePropType | null;
  readonly caption: string;
  readonly badge?: { readonly label: string; readonly tone: BadgeTone };
}

/** One photo tile; a failed load (offline, expired session) can be retried by tapping. */
function EvidenceTile({ item }: { readonly item: GalleryItem }) {
  const theme = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const tileStyle = [
    styles.tile,
    {
      borderRadius: theme.radii.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
  ];
  return (
    <View style={[styles.tileWrap, { gap: theme.spacing.xs }]}>
      {item.source === null || failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Load photo again"
          onPress={() => {
            setFailed(false);
            setAttempt(value => value + 1);
          }}
          style={[tileStyle, styles.placeholder]}
        >
          <AppText variant="caption" tone="muted">
            {item.source === null ? 'Not on this phone' : 'Tap to load'}
          </AppText>
        </Pressable>
      ) : (
        <Image
          key={attempt}
          source={item.source}
          style={tileStyle}
          resizeMode="cover"
          accessibilityLabel={item.caption}
          onError={() => setFailed(true)}
        />
      )}
      <AppText variant="caption" tone="muted" numberOfLines={1}>
        {item.caption}
      </AppText>
      {item.badge !== undefined ? (
        <Badge label={item.badge.label} tone={item.badge.tone} />
      ) : null}
    </View>
  );
}

export function EvidenceGallery({
  items,
  actions,
  notice,
}: {
  readonly items: readonly GalleryItem[];
  /** Capture buttons (the assigned worker only). */
  readonly actions?: React.ReactNode;
  readonly notice?: string;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (items.length === 0 && actions === undefined) {
    return null;
  }
  return (
    <Card>
      <AppText variant="label" tone="muted">
        Photos
      </AppText>
      {actions}
      {notice !== undefined ? (
        <AppText tone="danger" accessibilityRole="alert">
          {notice}
        </AppText>
      ) : null}
      {items.length === 0 ? (
        <AppText variant="caption" tone="muted">
          No photos yet.
        </AppText>
      ) : (
        <View style={[styles.grid, { gap: theme.spacing.md }]}>
          {items.map(item => (
            <EvidenceTile key={item.id} item={item} />
          ))}
        </View>
      )}
    </Card>
  );
}

/** The job's conversation, oldest first, with a composer when the viewer may write. */
export function JobMessages({
  job,
  composer,
  pendingIds = new Set<string>(),
}: {
  readonly job: JobDetail;
  readonly composer?: React.ReactNode;
  /** Messages written on this phone and not yet delivered. */
  readonly pendingIds?: ReadonlySet<string>;
}): React.JSX.Element | null {
  if (job.messages.length === 0 && composer === undefined) {
    return null;
  }
  return (
    <Card>
      <AppText variant="label" tone="muted">
        Messages
      </AppText>
      {job.messages.length === 0 ? (
        <AppText variant="caption" tone="muted">
          No messages yet. Messages here reach the job's worker and managers.
        </AppText>
      ) : null}
      {job.messages.map(message => (
        <InfoRow
          key={message.id}
          label={`${fullName(message.author)} · ${formatSchedule(
            message.occurredAt,
          )}${pendingIds.has(message.id) ? ' · waiting to send' : ''}`}
          value={message.body}
        />
      ))}
      {composer}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tileWrap: { width: 96 },
  tile: { width: 96, height: 96 },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 4 },
});
