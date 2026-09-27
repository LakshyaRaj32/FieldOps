import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import {
  AppText,
  badgeColors,
  Icon,
  Skeleton,
  type BadgeTone,
  type IconName,
} from '../../../components/ui';
import { useTheme } from '../../../theme';

export interface Metric {
  readonly label: string;
  readonly value: string;
  readonly icon: IconName;
  /** Colors the icon only; the number stays in text color. */
  readonly tone?: BadgeTone;
  /** A short explanation under the value, for example "3 unassigned". */
  readonly caption?: string;
}

/** Tiles per row: two on phones, three on wide phones and small tablets. */
function useColumns(): number {
  const { width } = useWindowDimensions();
  return width >= 600 ? 3 : 2;
}

/** A compact headline figure: icon, value, label and an optional caption. */
function MetricTile({
  metric,
  columns,
}: {
  readonly metric: Metric;
  readonly columns: number;
}): React.JSX.Element {
  const theme = useTheme();
  const tone = badgeColors(theme, metric.tone ?? 'neutral');
  return (
    <View
      accessible
      accessibilityLabel={`${metric.label}: ${metric.value}${
        metric.caption === undefined ? '' : `, ${metric.caption}`
      }`}
      style={[
        styles.tile,
        theme.elevation.card,
        columns === 3 ? styles.third : styles.half,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
          padding: theme.spacing.md,
          gap: theme.spacing.xs,
        },
      ]}
    >
      <View style={[styles.header, { gap: theme.spacing.sm }]}>
        <View
          style={[
            styles.icon,
            { backgroundColor: tone.background, borderRadius: theme.radii.sm },
          ]}
        >
          <Icon name={metric.icon} size="sm" color={tone.text} />
        </View>
        <AppText
          variant="captionStrong"
          tone="muted"
          numberOfLines={2}
          style={styles.label}
        >
          {metric.label}
        </AppText>
      </View>
      <AppText variant="title">{metric.value}</AppText>
      {metric.caption !== undefined ? (
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {metric.caption}
        </AppText>
      ) : null}
    </View>
  );
}

/** A responsive grid of metric tiles. */
export function MetricGrid({
  metrics,
}: {
  readonly metrics: readonly Metric[];
}): React.JSX.Element {
  const theme = useTheme();
  const columns = useColumns();
  return (
    <View style={[styles.grid, { gap: theme.spacing.md }]}>
      {metrics.map(metric => (
        <MetricTile key={metric.label} metric={metric} columns={columns} />
      ))}
    </View>
  );
}

/** Placeholder tiles in the grid's shape while the figures load. */
export function MetricGridSkeleton({
  count,
}: {
  readonly count: number;
}): React.JSX.Element {
  const theme = useTheme();
  const columns = useColumns();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading figures"
      style={[styles.grid, { gap: theme.spacing.md }]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.tile,
            columns === 3 ? styles.third : styles.half,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.md,
              gap: theme.spacing.sm,
            },
          ]}
        >
          <Skeleton width="55%" height={12} />
          <Skeleton width="35%" height={24} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    flexGrow: 1,
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Leave room for the gaps, so two (or three) tiles fit per row.
  half: { flexBasis: '47%' },
  third: { flexBasis: '31%' },
  header: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1 },
});
