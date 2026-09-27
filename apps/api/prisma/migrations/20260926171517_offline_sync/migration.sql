-- CreateTable
CREATE TABLE "job_notes" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_mutations" (
    "user_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "operation" VARCHAR(50) NOT NULL,
    "job_id" UUID NOT NULL,
    "response_status" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_mutations_pkey" PRIMARY KEY ("user_id","idempotency_key")
);

-- CreateIndex
CREATE INDEX "job_notes_job_id_created_at_idx" ON "job_notes"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_mutations" ADD CONSTRAINT "processed_mutations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: the API trims note text before writing; a blank note is never stored.
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_body_check" CHECK (btrim("body") <> '');

-- processed_mutations.job_id has no foreign key on purpose: the row records a request that
-- was processed, not a relationship, and must not block or follow changes to the job.
