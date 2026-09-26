import { logger } from './logger';

/**
 * Logs uncaught JavaScript errors, then hands them to React Native's default handler
 * (red box in development, crash in release). Errors are never swallowed: this only adds
 * a single place to attach crash reporting in Version 15.
 */
export function installGlobalErrorHandler(): void {
  const previousHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    logger.error('Unhandled JavaScript error', {
      isFatal: isFatal ?? false,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    });
    previousHandler(error, isFatal);
  });
}
