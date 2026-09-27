-- Business domain phase, part 1 of 2: enum values only.
--
-- PostgreSQL cannot use an enum value in the same transaction that adds it, and CHECK
-- constraints and backfills in part 2 use these values, so they are committed first.

-- ADMIN becomes ORGANIZATION_ADMIN (same meaning: administers one organization). Renaming the
-- value keeps every existing admin's role; nothing is converted.
ALTER TYPE "Role" RENAME VALUE 'ADMIN' TO 'ORGANIZATION_ADMIN';
-- The platform operator, above every organization.
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- The field lifecycle (packages/shared/src/job-state-machine.ts).
ALTER TYPE "JobStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "JobStatus" ADD VALUE 'EN_ROUTE';
ALTER TYPE "JobStatus" ADD VALUE 'ARRIVED';
ALTER TYPE "JobStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "JobStatus" ADD VALUE 'FAILED';

ALTER TYPE "JobEventType" ADD VALUE 'ACCEPTED';
ALTER TYPE "JobEventType" ADD VALUE 'DECLINED';
ALTER TYPE "JobEventType" ADD VALUE 'DEPARTED';
ALTER TYPE "JobEventType" ADD VALUE 'ARRIVED';
ALTER TYPE "JobEventType" ADD VALUE 'SUBMITTED';
ALTER TYPE "JobEventType" ADD VALUE 'VERIFIED';
ALTER TYPE "JobEventType" ADD VALUE 'REJECTED';
ALTER TYPE "JobEventType" ADD VALUE 'FAILED';
ALTER TYPE "JobEventType" ADD VALUE 'RESCHEDULED';

-- Notifications from the new business events.
ALTER TYPE "NotificationType" ADD VALUE 'JOB_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_OVERDUE';
