-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('JOB_ASSIGNED', 'JOB_UNASSIGNED', 'JOB_CANCELLED', 'JOB_COMPLETED', 'JOB_MESSAGE');

-- AlterTable
ALTER TABLE "job_events" ADD COLUMN     "accuracy_m" DOUBLE PRECISION,
ADD COLUMN     "distance_m" DOUBLE PRECISION,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "located_at" TIMESTAMPTZ(3),
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "job_evidence" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "content_type" VARCHAR(50) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_messages" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "job_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_evidence_storage_key_key" ON "job_evidence"("storage_key");

-- CreateIndex
CREATE INDEX "job_evidence_job_id_created_at_idx" ON "job_evidence"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "job_messages_job_id_created_at_idx" ON "job_messages"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_session_id_key" ON "push_devices"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_id_idx" ON "notifications"("user_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "job_evidence" ADD CONSTRAINT "job_evidence_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evidence" ADD CONSTRAINT "job_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_messages" ADD CONSTRAINT "job_messages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_messages" ADD CONSTRAINT "job_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: a location on a job event is complete or absent, within WGS 84 bounds, and
-- only on the events where the worker's phone reports one.
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_location_check" CHECK (
  (
    "latitude" IS NULL AND "longitude" IS NULL AND "accuracy_m" IS NULL
    AND "located_at" IS NULL AND "distance_m" IS NULL
  )
  OR (
    "type" IN ('STARTED', 'COMPLETED')
    AND "latitude" BETWEEN -90 AND 90
    AND "longitude" BETWEEN -180 AND 180
    AND "accuracy_m" >= 0
    AND "located_at" IS NOT NULL
    AND ("distance_m" IS NULL OR "distance_m" >= 0)
  )
);

-- Hand-written: evidence metadata the server computed must be plausible.
ALTER TABLE "job_evidence" ADD CONSTRAINT "job_evidence_metadata_check" CHECK (
  "content_type" IN ('image/jpeg', 'image/png')
  AND "size_bytes" > 0
  AND "width" > 0
  AND "height" > 0
);

-- Hand-written: the API trims message text before writing; a blank message is never stored.
ALTER TABLE "job_messages" ADD CONSTRAINT "job_messages_body_check" CHECK (btrim("body") <> '');
