import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import type { JobDetail } from '@fieldops/types';

import { ImageViewer } from '../../../components/common/ImageViewer';
import { InfoRow } from '../../../components/common/InfoRow';
import {
  AppText,
  Badge,
  Button,
  Card,
  Icon,
  SectionTitle,
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
      <SectionTitle title="Job site" icon="location-outline" />
      <InfoRow label="Address" value={job.address} />
      {location !== null ? (
        <View style={{ gap: theme.spacing.sm }}>
          <InfoRow
            label="Coordinates"
            value={`${location.latitude.toFixed(
              5,
            )}, ${location.longitude.toFixed(5)}`}
          />
          <Button
            label="Open in maps"
            icon="map-outline"
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
      <SectionTitle title="Visit" icon="navigate-outline" />
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
        Positions come from the worker's phone and can be off by the accuracy
        shown.
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

/**
 * One photo tile. Tapping a loaded photo opens it full screen (the same source: nothing is
 * downloaded or uploaded again); a failed load (offline, expired session) is retried by
 * tapping instead.
 */
function EvidenceTile({
  item,
  onOpen,
}: {
  readonly item: GalleryItem;
  readonly onOpen: (item: GalleryItem) => void;
}) {
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
          accessibilityLabel={
            item.source === null
              ? 'Photo not on this phone'
              : 'Load photo again'
          }
          disabled={item.source === null}
          onPress={() => {
            setFailed(false);
            setAttempt(value => value + 1);
          }}
          style={[tileStyle, styles.placeholder, { gap: theme.spacing.xs }]}
        >
          <Icon
            name={item.source === null ? 'image-outline' : 'refresh'}
            tone="muted"
          />
          <AppText variant="caption" tone="muted" style={styles.centered}>
            {item.source === null ? 'Not on this phone' : 'Tap to load'}
          </AppText>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photo, ${item.caption}`}
          accessibilityHint="Opens the photo full screen"
          onPress={() => onOpen(item)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Image
            key={attempt}
            source={item.source}
            style={tileStyle}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
          <View
            style={[
              styles.zoomBadge,
              theme.elevation.raised,
              {
                backgroundColor: theme.colors.overlay,
                borderRadius: theme.radii.pill,
              },
            ]}
          >
            <Icon name="expand-outline" size="sm" color="#FFFFFF" />
          </View>
        </Pressable>
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
  const [opened, setOpened] = useState<GalleryItem | null>(null);
  if (items.length === 0 && actions === undefined) {
    return null;
  }
  return (
    <Card>
      <SectionTitle
        title="Photos"
        icon="images-outline"
        {...(items.length > 0 && {
          accessory: (
            <AppText variant="caption" tone="muted">
              {items.length}
            </AppText>
          ),
        })}
      />
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
            <EvidenceTile key={item.id} item={item} onOpen={setOpened} />
          ))}
        </View>
      )}
      <ImageViewer
        visible={opened !== null}
        source={opened?.source ?? null}
        caption={opened?.caption ?? ''}
        onClose={() => setOpened(null)}
      />
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
      <SectionTitle title="Messages" icon="chatbubbles-outline" />
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
  centered: { textAlign: 'center' },
  pressed: { opacity: 0.85 },
  zoomBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
