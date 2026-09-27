import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { JobOverview } from '@fieldops/types';

import { AppText, Card, SectionTitle } from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  BUCKETS,
  formatPercent,
  statusSegments,
  totalJobs,
} from '../dashboardMetrics';

/**
 * Every operation by stage as one stacked bar, with a legend that names each stage and
 * gives its count and share. The legend is the readable version of the bar (text in text
 * colors, a swatch beside it), so nothing depends on telling colors apart.
 */
export function StatusBreakdown({
  counts,
}: {
  readonly counts: JobOverview['statusCounts'];
}): React.JSX.Element {
  const theme = useTheme();
  const total = totalJobs(counts);
  const segments = statusSegments(counts);
  const visible = segments.filter(segment => segment.count > 0);

  return (
    <Card>
      <SectionTitle
        title="Operations by stage"
        icon="pie-chart-outline"
        accessory={
          <AppText variant="caption" tone="muted">
            {total} total
          </AppText>
        }
      />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Operations by stage: ${segments
          .map(segment => `${BUCKETS[segment.bucket].label} ${segment.count}`)
          .join(', ')}`}
        style={[
          styles.bar,
          {
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.surfaceMuted,
          },
        ]}
      >
        {visible.map(segment => (
          <View
            key={segment.bucket}
            style={[
              styles.segment,
              {
                flexGrow: segment.count,
                backgroundColor: theme.chart[BUCKETS[segment.bucket].chart],
              },
            ]}
          />
        ))}
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        {segments.map(segment => (
          <View
            key={segment.bucket}
            style={[styles.legendRow, { gap: theme.spacing.sm }]}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: theme.chart[BUCKETS[segment.bucket].chart] },
              ]}
            />
            <AppText style={styles.legendLabel}>
              {BUCKETS[segment.bucket].label}
            </AppText>
            <AppText variant="bodyStrong">{segment.count}</AppText>
            <AppText variant="caption" tone="muted" style={styles.share}>
              {total === 0 ? '–' : formatPercent(segment.share)}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // The 2 dp gaps between segments show the surface, so neighbors never touch.
  bar: { flexDirection: 'row', height: 12, overflow: 'hidden', gap: 2 },
  segment: { flexBasis: 0 },
  legendRow: { flexDirection: 'row', alignItems: 'center', minHeight: 24 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { flex: 1 },
  share: { width: 40, textAlign: 'right' },
});
