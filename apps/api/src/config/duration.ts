const UNIT_SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const;

const DURATION_PATTERN = /^(\d+)([smhd])$/;

/**
 * Parses a duration such as `15m` or `30d` into whole seconds. Returns undefined for
 * anything else. The format is intentionally small: one integer and one unit.
 */
export function parseDurationSeconds(value: string): number | undefined {
  const match = DURATION_PATTERN.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_SECONDS;
  const seconds = amount * UNIT_SECONDS[unit];
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}
