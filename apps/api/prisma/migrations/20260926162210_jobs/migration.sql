-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM ('CREATED', 'ASSIGNED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "customer_name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_worker_id" UUID,
    "notes" VARCHAR(5000),
    "cancellation_reason" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_checklist_items" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "type" "JobEventType" NOT NULL,
    "from_status" "JobStatus",
    "to_status" "JobStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "assignee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_assigned_worker_id_scheduled_at_idx" ON "jobs"("assigned_worker_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "jobs_status_scheduled_at_idx" ON "jobs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "jobs_scheduled_at_id_idx" ON "jobs"("scheduled_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_checklist_items_job_id_position_key" ON "job_checklist_items"("job_id", "position");

-- CreateIndex
CREATE INDEX "job_events_job_id_created_at_idx" ON "job_events"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_worker_id_fkey" FOREIGN KEY ("assigned_worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_checklist_items" ADD CONSTRAINT "job_checklist_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: invariants the application maintains, enforced by the database as well
-- (docs/database.md, "Conventions").

-- Required text is never blank (the API trims input before writing).
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_text_check"
  CHECK (btrim("title") <> '' AND btrim("customer_name") <> '' AND btrim("address") <> '');
ALTER TABLE "job_checklist_items" ADD CONSTRAINT "job_checklist_items_label_check"
  CHECK (btrim("label") <> '' AND "position" >= 0);

-- Coordinates come as a valid pair or not at all.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_location_check"
  CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL) OR
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  );

-- Status and assignment agree: a PENDING job has no worker, ASSIGNED / IN_PROGRESS /
-- COMPLETED jobs have one; a CANCELLED job keeps whatever it had.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assignment_check"
  CHECK ("status" = 'CANCELLED' OR (("status" = 'PENDING') = ("assigned_worker_id" IS NULL)));

-- Lifecycle timestamps exist for the statuses that imply them.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lifecycle_timestamps_check"
  CHECK (
    ("status" NOT IN ('IN_PROGRESS', 'COMPLETED') OR "started_at" IS NOT NULL) AND
    ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL) AND
    ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL)
  );

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_version_check" CHECK ("version" >= 1);
