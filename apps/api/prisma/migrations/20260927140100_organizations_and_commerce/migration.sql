-- Business domain phase, part 2 of 2: organizations (tenancy), teams, shops, products,
-- orders, payments, operation types and the audit log. See docs/business-domain.md and
-- docs/database.md. Generated with `prisma migrate diff`, then completed by hand where
-- marked (backfill, partial indexes, CHECK constraints, the audit trigger).
-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GENERAL', 'DELIVERY', 'PAYMENT_COLLECTION', 'SHOP_VISIT', 'ORDER_COLLECTION', 'INVENTORY_CHECK');

-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_assigned_worker_id_fkey";

-- DropIndex
DROP INDEX "jobs_status_scheduled_at_idx";

-- DropIndex
DROP INDEX "jobs_scheduled_at_id_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "organization_wide_access" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "arrived_at" TIMESTAMPTZ(3),
ADD COLUMN     "expected_amount" BIGINT,
ADD COLUMN     "failed_at" TIMESTAMPTZ(3),
ADD COLUMN     "failure_reason" VARCHAR(500),
ADD COLUMN     "manager_id" UUID,
ADD COLUMN     "order_id" UUID,
ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "requires_photo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shop_id" UUID,
ADD COLUMN     "submission_note" VARCHAR(2000),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3),
ADD COLUMN     "type" "JobType" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "job_checklist_items" ADD COLUMN     "checked" BOOLEAN,
ADD COLUMN     "response_note" VARCHAR(500);

-- AlterTable
ALTER TABLE "job_events" ADD COLUMN     "reason" VARCHAR(500);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "shop_id" UUID,
ALTER COLUMN "job_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_name" VARCHAR(200),
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(30),
    "address" VARCHAR(500),
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "arrival_radius_m" INTEGER NOT NULL DEFAULT 300,
    "next_order_number" INTEGER NOT NULL DEFAULT 1001,
    "suspended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "owner_name" VARCHAR(200),
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "address" VARCHAR(500) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "shop_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "category" VARCHAR(100),
    "unit_price" BIGINT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "order_number" VARCHAR(30) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "total_amount" BIGINT NOT NULL,
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "order_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "notes" VARCHAR(2000),
    "created_by_id" UUID NOT NULL,
    "source_job_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(500),
    "overdue_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,
    "delivered_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "job_id" UUID,
    "amount" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(100),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_lines" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "order_item_id" UUID,
    "expected_quantity" INTEGER,
    "quantity" INTEGER,

    CONSTRAINT "job_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_id" UUID,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------------------
-- Hand-written: backfill of the existing single-organization data.
--
-- Before this phase the deployment was one implicit organization. Existing users and jobs
-- move into an explicit "Default organization" (created only when there is data to move),
-- and every existing job's responsible manager is the person who created it.
-- ---------------------------------------------------------------------------------------
INSERT INTO "organizations" ("id", "name", "updated_at")
SELECT gen_random_uuid(), 'Default organization', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "jobs");

UPDATE "users" SET "organization_id" = (SELECT "id" FROM "organizations" LIMIT 1)
WHERE "organization_id" IS NULL;

UPDATE "jobs" SET
  "organization_id" = (SELECT "id" FROM "organizations" LIMIT 1),
  "manager_id" = "created_by_id"
WHERE "organization_id" IS NULL;

ALTER TABLE "jobs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "jobs" ALTER COLUMN "manager_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "team_memberships_manager_id_ended_at_idx" ON "team_memberships"("manager_id", "ended_at");

-- CreateIndex
CREATE INDEX "team_memberships_worker_id_started_at_idx" ON "team_memberships"("worker_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "shops_organization_id_name_key" ON "shops"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "shops_id_organization_id_key" ON "shops"("id", "organization_id");

-- CreateIndex
CREATE INDEX "shop_assignments_user_id_ended_at_idx" ON "shop_assignments"("user_id", "ended_at");

-- CreateIndex
CREATE INDEX "shop_assignments_shop_id_ended_at_idx" ON "shop_assignments"("shop_id", "ended_at");

-- CreateIndex
CREATE INDEX "products_organization_id_name_idx" ON "products"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_organization_id_key" ON "products"("id", "organization_id");

-- CreateIndex
CREATE INDEX "orders_shop_id_created_at_idx" ON "orders"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_organization_id_due_date_idx" ON "orders"("organization_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organization_id_order_number_key" ON "orders"("organization_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_organization_id_key" ON "orders"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_position_key" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "payments_order_id_status_idx" ON "payments"("order_id", "status");

-- CreateIndex
CREATE INDEX "payments_organization_id_status_verified_at_idx" ON "payments"("organization_id", "status", "verified_at");

-- CreateIndex
CREATE INDEX "payments_job_id_idx" ON "payments"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_lines_job_id_position_key" ON "job_lines"("job_id", "position");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "users_organization_id_role_idx" ON "users"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_organization_id_key" ON "users"("id", "organization_id");

-- CreateIndex
CREATE INDEX "jobs_organization_id_scheduled_at_id_idx" ON "jobs"("organization_id", "scheduled_at", "id");

-- CreateIndex
CREATE INDEX "jobs_organization_id_status_scheduled_at_idx" ON "jobs"("organization_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "jobs_manager_id_scheduled_at_id_idx" ON "jobs"("manager_id", "scheduled_at", "id");

-- CreateIndex
CREATE INDEX "jobs_shop_id_scheduled_at_idx" ON "jobs"("shop_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "jobs_order_id_idx" ON "jobs"("order_id");

-- CreateIndex
CREATE INDEX "job_events_created_at_idx" ON "job_events"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_manager_id_organization_id_fkey" FOREIGN KEY ("manager_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_worker_id_organization_id_fkey" FOREIGN KEY ("worker_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_assignments" ADD CONSTRAINT "shop_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_assignments" ADD CONSTRAINT "shop_assignments_shop_id_organization_id_fkey" FOREIGN KEY ("shop_id", "organization_id") REFERENCES "shops"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shop_assignments" ADD CONSTRAINT "shop_assignments_user_id_organization_id_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_organization_id_fkey" FOREIGN KEY ("shop_id", "organization_id") REFERENCES "shops"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_organization_id_fkey" FOREIGN KEY ("order_id", "organization_id") REFERENCES "orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_manager_id_organization_id_fkey" FOREIGN KEY ("manager_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_worker_id_organization_id_fkey" FOREIGN KEY ("assigned_worker_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_organization_id_fkey" FOREIGN KEY ("shop_id", "organization_id") REFERENCES "shops"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_order_id_organization_id_fkey" FOREIGN KEY ("order_id", "organization_id") REFERENCES "orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Hand-written: partial unique indexes (Prisma cannot express them; keep them if a
-- generated migration proposes dropping them). See docs/database.md.
-- ---------------------------------------------------------------------------------------

-- A worker is in at most one team at a time.
CREATE UNIQUE INDEX "team_memberships_current_worker_key"
  ON "team_memberships" ("worker_id") WHERE "ended_at" IS NULL;

-- A person is assigned to a shop at most once at a time.
CREATE UNIQUE INDEX "shop_assignments_current_key"
  ON "shop_assignments" ("shop_id", "user_id") WHERE "ended_at" IS NULL;

-- A payment reference (transaction ID, UPI reference, cheque number) is recorded once per
-- organization and method, unless the earlier payment was rejected. This is what stops the
-- same bank transfer from being counted twice, whatever the client sends.
CREATE UNIQUE INDEX "payments_reference_key"
  ON "payments" ("organization_id", "method", "reference")
  WHERE "reference" IS NOT NULL AND "status" <> 'REJECTED';

-- ---------------------------------------------------------------------------------------
-- Hand-written: invariants the application maintains, enforced by the database as well
-- (docs/database.md, "Conventions").
-- ---------------------------------------------------------------------------------------

-- Organizations.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_values_check" CHECK (
  btrim("name") <> ''
  AND "currency" ~ '^[A-Z]{3}$'
  AND btrim("time_zone") <> ''
  AND "arrival_radius_m" BETWEEN 10 AND 50000
  AND "next_order_number" >= 1
  AND (("status" = 'SUSPENDED') = ("suspended_at" IS NOT NULL))
);

-- Only the platform's SUPER_ADMINs are outside every organization, plus self-registered
-- workers until an organization adds them. Organization-wide access is a manager's grant.
ALTER TABLE "users" ADD CONSTRAINT "users_organization_check" CHECK (
  ("role" = 'SUPER_ADMIN' AND "organization_id" IS NULL)
  OR ("role" <> 'SUPER_ADMIN' AND ("organization_id" IS NOT NULL OR "role" = 'WORKER'))
);
ALTER TABLE "users" ADD CONSTRAINT "users_organization_wide_access_check" CHECK (
  NOT "organization_wide_access" OR "role" = 'MANAGER'
);

-- Periods run forwards; nobody manages themselves.
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_period_check" CHECK (
  "manager_id" <> "worker_id" AND ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
ALTER TABLE "shop_assignments" ADD CONSTRAINT "shop_assignments_period_check" CHECK (
  "ended_at" IS NULL OR "ended_at" >= "started_at"
);

-- Shops: required text is never blank; coordinates come as a valid pair or not at all.
ALTER TABLE "shops" ADD CONSTRAINT "shops_values_check" CHECK (
  btrim("name") <> '' AND btrim("address") <> ''
  AND (
    ("latitude" IS NULL AND "longitude" IS NULL) OR
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  )
);

ALTER TABLE "products" ADD CONSTRAINT "products_values_check" CHECK (
  btrim("name") <> '' AND btrim("sku") <> '' AND "unit_price" >= 0
);

-- Orders: the paid amount (sum of verified payments) never exceeds the total, so the
-- database itself refuses an overpayment; a cancelled order has nothing paid.
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK (
  "total_amount" >= 0
  AND "paid_amount" >= 0
  AND "paid_amount" <= "total_amount"
  AND "due_date" >= "order_date"
  AND (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL))
  AND ("status" <> 'CANCELLED' OR "paid_amount" = 0)
);

-- Order items: the line total is exactly quantity x price, and nothing is delivered twice.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_values_check" CHECK (
  "position" >= 0
  AND "quantity" > 0
  AND "unit_price" >= 0
  AND "line_total" = "quantity" * "unit_price"
  AND "delivered_quantity" BETWEEN 0 AND "quantity"
);

-- Payments: positive; traceable unless cash; verification fields match the status.
ALTER TABLE "payments" ADD CONSTRAINT "payments_values_check" CHECK (
  "amount" > 0
  AND ("method" = 'CASH' OR "reference" IS NOT NULL)
  AND ("reference" IS NULL OR btrim("reference") <> '')
  AND (("status" = 'PENDING_VERIFICATION') = ("verified_at" IS NULL))
  AND (("verified_at" IS NULL) = ("verified_by_id" IS NULL))
  AND (("status" = 'REJECTED') = ("rejection_reason" IS NOT NULL))
);

-- Operations: what each type refers to. A shop for every type except GENERAL, an order for
-- deliveries and collections, an expected amount for (and only for) collections. GENERAL
-- jobs keep the basic lifecycle's statuses.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK (
  (("type" = 'GENERAL') = ("shop_id" IS NULL))
  AND ("type" NOT IN ('DELIVERY', 'PAYMENT_COLLECTION') OR "order_id" IS NOT NULL)
  AND (("type" = 'PAYMENT_COLLECTION') = ("expected_amount" IS NOT NULL))
  AND ("expected_amount" IS NULL OR "expected_amount" > 0)
  AND ("type" <> 'GENERAL' OR "status" IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);

-- Lifecycle timestamps exist for the statuses that imply them (replaces the Phase 2 check,
-- adding the field lifecycle's statuses).
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_lifecycle_timestamps_check";
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lifecycle_timestamps_check" CHECK (
  ("status" NOT IN ('IN_PROGRESS', 'SUBMITTED', 'COMPLETED') OR "started_at" IS NOT NULL) AND
  ("type" = 'GENERAL' OR "status" NOT IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED') OR "accepted_at" IS NOT NULL) AND
  ("status" <> 'SUBMITTED' OR "submitted_at" IS NOT NULL) AND
  ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL) AND
  ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL) AND
  ("status" <> 'FAILED' OR ("failed_at" IS NOT NULL AND "failure_reason" IS NOT NULL))
);

ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_values_check" CHECK (
  "position" >= 0
  AND ("expected_quantity" IS NULL OR "expected_quantity" >= 0)
  AND ("quantity" IS NULL OR "quantity" >= 0)
);

-- A location may now be recorded on every status change the worker's phone reports.
ALTER TABLE "job_events" DROP CONSTRAINT "job_events_location_check";
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_location_check" CHECK (
  (
    "latitude" IS NULL AND "longitude" IS NULL AND "accuracy_m" IS NULL
    AND "located_at" IS NULL AND "distance_m" IS NULL
  )
  OR (
    "type" IN ('DEPARTED', 'ARRIVED', 'STARTED', 'SUBMITTED', 'COMPLETED', 'FAILED')
    AND "latitude" BETWEEN -90 AND 90
    AND "longitude" BETWEEN -180 AND 180
    AND "accuracy_m" >= 0
    AND "located_at" IS NOT NULL
    AND ("distance_m" IS NULL OR "distance_m" >= 0)
  )
);

-- Every notification is about an operation, except an overdue payment (about a shop).
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (
  "job_id" IS NOT NULL OR ("type" = 'PAYMENT_OVERDUE' AND "shop_id" IS NOT NULL)
);

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_values_check" CHECK (
  btrim("action") <> '' AND btrim("entity_type") <> '' AND btrim("summary") <> ''
);

-- The audit log is append-only: history cannot be rewritten through any database session
-- the application uses. (TRUNCATE, used only by the E2E test reset, is not a row change.)
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
