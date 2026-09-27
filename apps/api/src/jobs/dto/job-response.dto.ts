import { ApiProperty } from '@nestjs/swagger';
import type {
  ActionLocation,
  EvidenceContentType,
  JobChecklistItem,
  JobDetail,
  JobEvidence,
  JobHistoryEntry,
  JobLine,
  JobMessage,
  JobNote,
  JobOrder,
  JobPage,
  JobShop,
  JobSummary,
  JobWorkingSet,
  Product,
} from '@fieldops/types';

import { UserSummaryDto } from '../../common/dto/user-summary.dto.js';
import { toAmountOrNull } from '../../common/money.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { ProductDto } from '../../catalog/dto/product.dto.js';
import { PaymentRecordDto } from '../../shops/dto/order.dto.js';
import type {
  JobDetailRecord,
  JobSummaryRecord,
} from '../data/jobs.repository.js';
import { allowedActions } from '../domain/job.policy.js';
import {
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
  JobType,
} from '../job-enums.js';
import { GeoPointDto } from './job-fields.js';

export { UserSummaryDto };

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export class JobChecklistItemDto implements JobChecklistItem {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 0 }) readonly position: number;
  @ApiProperty({ example: 'Is the display correct?' }) readonly label: string;
  @ApiProperty({ type: Boolean, nullable: true }) readonly checked:
    boolean | null;
  @ApiProperty({ type: String, nullable: true }) readonly responseNote:
    string | null;
}

export class JobShopDto implements JobShop {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Nike Chandigarh' }) readonly name: string;
  @ApiProperty({ type: String, nullable: true }) readonly ownerName:
    string | null;
  @ApiProperty({ type: String, nullable: true }) readonly phone: string | null;
  @ApiProperty() readonly address: string;
}

export class JobOrderDto implements JobOrder {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'ORD-1001' }) readonly orderNumber: string;
}

export class JobLineDto implements JobLine {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty() readonly position: number;
  @ApiProperty({ format: 'uuid' }) readonly productId: string;
  @ApiProperty() readonly productName: string;
  @ApiProperty() readonly sku: string;
  @ApiProperty({ type: Number, nullable: true })
  readonly expectedQuantity: number | null;
  @ApiProperty({ type: Number, nullable: true }) readonly quantity:
    number | null;
}

export class JobSummaryDto implements JobSummary {
  @ApiProperty({ format: 'uuid' }) readonly id: string;

  @ApiProperty({ enum: Object.values(JobType) }) readonly type: JobType;

  @ApiProperty({ example: 'Collect September dues' }) readonly title: string;

  @ApiProperty({ example: 'Nike Chandigarh' }) readonly customerName: string;

  @ApiProperty({ example: 'SCO 12, Sector 17, Chandigarh' })
  readonly address: string;

  @ApiProperty({ format: 'date-time' }) readonly scheduledAt: string;

  @ApiProperty({ enum: Object.values(JobPriority) })
  readonly priority: JobPriority;

  @ApiProperty({ enum: Object.values(JobStatus) }) readonly status: JobStatus;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly assignedWorker: UserSummaryDto | null;

  @ApiProperty({ type: UserSummaryDto }) readonly manager: UserSummaryDto;

  @ApiProperty({ type: JobShopDto, nullable: true })
  readonly shop: JobShopDto | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'PAYMENT_COLLECTION: minor units to collect (set by the manager).',
  })
  readonly expectedAmount: number | null;

  @ApiProperty({
    example: 2,
    description: 'Send back with PATCH (optimistic concurrency).',
  })
  readonly version: number;

  @ApiProperty({ format: 'date-time' }) readonly updatedAt: string;

  @ApiProperty({
    enum: Object.values(JobAction),
    isArray: true,
    example: ['accept', 'message', 'decline'],
    description:
      'What the signed-in user may do with this job right now. Clients show exactly these.',
  })
  readonly allowedActions: JobAction[];

  static from(job: JobSummaryRecord, user: AuthenticatedUser): JobSummaryDto {
    return Object.assign(new JobSummaryDto(), summaryFields(job, user));
  }
}

function summaryFields(
  job: JobSummaryRecord,
  user: AuthenticatedUser,
): JobSummary {
  return {
    id: job.id,
    type: job.type,
    title: job.title,
    customerName: job.customerName,
    address: job.address,
    scheduledAt: job.scheduledAt.toISOString(),
    priority: job.priority,
    status: job.status,
    assignedWorker:
      job.assignedWorker === null
        ? null
        : UserSummaryDto.from(job.assignedWorker),
    manager: UserSummaryDto.from(job.manager),
    shop: job.shop,
    expectedAmount: toAmountOrNull(job.expectedAmount),
    version: job.version,
    updatedAt: job.updatedAt.toISOString(),
    allowedActions: allowedActions(user, job),
  };
}

export class JobHistoryEntryDto implements JobHistoryEntry {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ enum: Object.values(JobEventType) })
  readonly type: JobEventType;
  @ApiProperty({ enum: Object.values(JobStatus), nullable: true })
  readonly fromStatus: JobStatus | null;
  @ApiProperty({ enum: Object.values(JobStatus) }) readonly toStatus: JobStatus;
  @ApiProperty({ type: UserSummaryDto }) readonly actor: UserSummaryDto;
  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly assignee: UserSummaryDto | null;
  @ApiProperty({ type: String, nullable: true }) readonly reason: string | null;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
}

export class JobNoteDto implements JobNote {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Owner asked to come back after 5 pm.' })
  readonly body: string;
  @ApiProperty({ type: UserSummaryDto }) readonly author: UserSummaryDto;
  @ApiProperty({
    format: 'date-time',
    description: 'Device time of capture (informational).',
  })
  readonly occurredAt: string;
  @ApiProperty({
    format: 'date-time',
    description: 'Server receipt time (authoritative order).',
  })
  readonly createdAt: string;
}

export class ActionLocationDto implements ActionLocation {
  @ApiProperty({ example: 30.7333 }) readonly latitude: number;
  @ApiProperty({ example: 76.7794 }) readonly longitude: number;
  @ApiProperty({ example: 12.5, description: 'Reported accuracy in meters.' })
  readonly accuracyMeters: number;
  @ApiProperty({
    format: 'date-time',
    description: 'Device time of the fix (informational).',
  })
  readonly capturedAt: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 42,
    description:
      'Distance from the job site in meters, computed by the server; null when the job has no coordinates.',
  })
  readonly distanceMeters: number | null;
}

export class JobEvidenceDto implements JobEvidence {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png'] })
  readonly contentType: EvidenceContentType;
  @ApiProperty({ example: 412_345 }) readonly sizeBytes: number;
  @ApiProperty({ example: 1920 }) readonly width: number;
  @ApiProperty({ example: 1440 }) readonly height: number;
  @ApiProperty({ type: UserSummaryDto }) readonly uploadedBy: UserSummaryDto;
  @ApiProperty({
    format: 'date-time',
    description: 'Device time of capture (informational).',
  })
  readonly capturedAt: string;
  @ApiProperty({ format: 'date-time', description: 'Server receipt time.' })
  readonly createdAt: string;
}

export class JobMessageDto implements JobMessage {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Reached the shop; owner is in a meeting.' })
  readonly body: string;
  @ApiProperty({ type: UserSummaryDto }) readonly author: UserSummaryDto;
  @ApiProperty({
    format: 'date-time',
    description: 'Device time (informational).',
  })
  readonly occurredAt: string;
  @ApiProperty({ format: 'date-time', description: 'Server receipt time.' })
  readonly createdAt: string;
}

type EventRow = JobDetailRecord['events'][number];

/** The location of the latest event of one of `types` that has one. */
function locationOf(
  events: readonly EventRow[],
  types: readonly EventRow['type'][],
): ActionLocation | null {
  const event = events.findLast(
    row => types.includes(row.type) && row.latitude !== null,
  );
  if (
    event === undefined ||
    event.latitude === null ||
    event.longitude === null ||
    event.accuracyMeters === null ||
    event.locatedAt === null
  ) {
    return null;
  }
  return {
    latitude: event.latitude,
    longitude: event.longitude,
    accuracyMeters: event.accuracyMeters,
    capturedAt: event.locatedAt.toISOString(),
    distanceMeters: event.distanceMeters,
  };
}

export class JobDetailDto extends JobSummaryDto implements JobDetail {
  @ApiProperty({ type: String, nullable: true }) readonly description:
    string | null;
  @ApiProperty({ type: GeoPointDto, nullable: true })
  readonly location: GeoPointDto | null;
  @ApiProperty({ type: String, nullable: true }) readonly notes: string | null;
  @ApiProperty({ type: [JobChecklistItemDto] })
  readonly checklist: JobChecklistItemDto[];
  @ApiProperty({ type: String, nullable: true })
  readonly cancellationReason: string | null;
  @ApiProperty({ type: UserSummaryDto }) readonly createdBy: UserSummaryDto;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly acceptedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly arrivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly startedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly submittedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly completedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly cancelledAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly failedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) readonly failureReason:
    string | null;
  @ApiProperty({ type: JobOrderDto, nullable: true })
  readonly order: JobOrderDto | null;
  @ApiProperty({ type: [JobLineDto] }) readonly lines: JobLineDto[];
  @ApiProperty({ type: [PaymentRecordDto] })
  readonly payments: PaymentRecordDto[];
  @ApiProperty() readonly requiresPhoto: boolean;
  @ApiProperty({ type: String, nullable: true }) readonly submissionNote:
    string | null;
  @ApiProperty({ example: 300 }) readonly siteRadiusMeters: number;
  @ApiProperty({ type: [JobHistoryEntryDto], description: 'Oldest first.' })
  readonly history: JobHistoryEntryDto[];
  @ApiProperty({
    type: [JobNoteDto],
    description: 'Worker field notes, in the order the server received them.',
  })
  readonly fieldNotes: JobNoteDto[];
  @ApiProperty({ type: ActionLocationDto, nullable: true })
  readonly arrivalLocation: ActionLocationDto | null;
  @ApiProperty({ type: ActionLocationDto, nullable: true })
  readonly startLocation: ActionLocationDto | null;
  @ApiProperty({ type: ActionLocationDto, nullable: true })
  readonly completeLocation: ActionLocationDto | null;
  @ApiProperty({
    type: [JobEvidenceDto],
    description:
      'Photos, oldest first. Download one with GET /jobs/{id}/evidence/{evidenceId}/content.',
  })
  readonly evidence: JobEvidenceDto[];
  @ApiProperty({
    type: [JobMessageDto],
    description: 'The latest messages (at most 100), oldest first.',
  })
  readonly messages: JobMessageDto[];

  static override from(
    job: JobDetailRecord,
    user: AuthenticatedUser,
  ): JobDetailDto {
    return Object.assign(new JobDetailDto(), {
      ...summaryFields(job, user),
      description: job.description,
      location:
        job.latitude === null || job.longitude === null
          ? null
          : { latitude: job.latitude, longitude: job.longitude },
      notes: job.notes,
      checklist: job.checklistItems.map(item => ({
        id: item.id,
        position: item.position,
        label: item.label,
        checked: item.checked,
        responseNote: item.responseNote,
      })),
      cancellationReason: job.cancellationReason,
      createdBy: UserSummaryDto.from(job.createdBy),
      createdAt: job.createdAt.toISOString(),
      acceptedAt: iso(job.acceptedAt),
      arrivedAt: iso(job.arrivedAt),
      startedAt: iso(job.startedAt),
      submittedAt: iso(job.submittedAt),
      completedAt: iso(job.completedAt),
      cancelledAt: iso(job.cancelledAt),
      failedAt: iso(job.failedAt),
      failureReason: job.failureReason,
      order: job.order,
      lines: job.lines.map(line => ({
        id: line.id,
        position: line.position,
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        expectedQuantity: line.expectedQuantity,
        quantity: line.quantity,
      })),
      payments: job.payments.map(payment => PaymentRecordDto.from(payment)),
      requiresPhoto: job.requiresPhoto,
      submissionNote: job.submissionNote,
      siteRadiusMeters: job.organization.arrivalRadiusMeters,
      history: job.events.map(event => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actor: UserSummaryDto.from(event.actor),
        assignee:
          event.assignee === null ? null : UserSummaryDto.from(event.assignee),
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
      })),
      fieldNotes: job.fieldNotes.map(note => ({
        id: note.id,
        body: note.body,
        author: UserSummaryDto.from(note.author),
        occurredAt: note.occurredAt.toISOString(),
        createdAt: note.createdAt.toISOString(),
      })),
      arrivalLocation: locationOf(job.events, [JobEventType.ARRIVED]),
      startLocation: locationOf(job.events, [JobEventType.STARTED]),
      completeLocation: locationOf(job.events, [
        JobEventType.COMPLETED,
        JobEventType.SUBMITTED,
      ]),
      evidence: job.evidence.map(item => ({
        id: item.id,
        contentType: item.contentType as EvidenceContentType,
        sizeBytes: item.sizeBytes,
        width: item.width,
        height: item.height,
        uploadedBy: UserSummaryDto.from(item.uploadedBy),
        capturedAt: item.capturedAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
      })),
      // Loaded newest first (to keep the latest 100); shown oldest first.
      messages: job.messages
        .map(message => ({
          id: message.id,
          body: message.body,
          author: UserSummaryDto.from(message.author),
          occurredAt: message.occurredAt.toISOString(),
          createdAt: message.createdAt.toISOString(),
        }))
        .reverse(),
    } satisfies JobDetail);
  }
}

export class JobPageDto implements JobPage {
  @ApiProperty({ type: [JobSummaryDto] }) readonly items: JobSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` for the next page; null on the last page.',
  })
  readonly nextCursor: string | null;
}

export class JobWorkingSetDto implements JobWorkingSet {
  @ApiProperty({
    type: [JobDetailDto],
    description:
      'Open jobs assigned to the caller, plus jobs closed in the last 7 days (at most 200).',
  })
  readonly jobs: JobDetailDto[];

  @ApiProperty({
    type: [ProductDto],
    description:
      'The active catalog, while the worker has an open order collection (else empty).',
  })
  readonly products: Product[];

  @ApiProperty({ format: 'date-time' }) readonly generatedAt: string;
}
