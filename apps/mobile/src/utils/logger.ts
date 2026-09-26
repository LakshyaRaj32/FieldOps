/**
 * The single logging entry point for the app. ESLint forbids `console` everywhere else.
 *
 * warn/error are always emitted (they reach logcat in release builds). debug/info are
 * development-only. Version 15 connects this to crash reporting and structured telemetry.
 *
 * Never log tokens, passwords or personal data.
 */

export type LogContext = Readonly<Record<string, unknown>>;

function emit(
  write: (...args: unknown[]) => void,
  message: string,
  context: LogContext | undefined,
): void {
  if (context === undefined) {
    write(`[FieldOps] ${message}`);
  } else {
    write(`[FieldOps] ${message}`, context);
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (__DEV__) {
      emit(console.debug, message, context);
    }
  },
  info(message: string, context?: LogContext): void {
    if (__DEV__) {
      emit(console.info, message, context);
    }
  },
  warn(message: string, context?: LogContext): void {
    emit(console.warn, message, context);
  },
  error(message: string, context?: LogContext): void {
    emit(console.error, message, context);
  },
};
