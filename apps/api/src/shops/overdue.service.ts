import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { formatMoney } from '@fieldops/shared/money';

import { AccessService } from '../access/access.service.js';
import { writeAudit } from '../audit/audit.js';
import { calendarDate, dateOnly, toAmount } from '../common/money.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEvents } from '../events/domain-events.js';
import { BackgroundTasks } from '../queue/background-tasks.service.js';

export const OVERDUE_SCAN_TASK = 'payments.overdue-scan';

/** Orders handled per organization per run (the next run takes the rest). */
const BATCH = 200;

/**
 * Finds unpaid orders past their due date and tells the people responsible for the shop,
 * once per order. Each order is claimed with a conditional UPDATE (overdue_notified_at IS
 * NULL), so even two API instances running the scan at once notify only once.
 *
 * "Past due" uses the organization's calendar: an order due on 30 September is overdue from
 * 1 October in the organization's time zone.
 *
 * A scheduled background task (docs/background-tasks.md): with Redis, each tick runs on one
 * instance only; OVERDUE_SCAN_INTERVAL sets the period or turns it off. It is not retried:
 * the next tick picks up whatever this one missed.
 */
@Injectable()
export class OverdueService implements OnModuleInit {
  private readonly logger = new Logger(OverdueService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tasks: BackgroundTasks,
  ) {}

  onModuleInit(): void {
    this.tasks.define({
      name: OVERDUE_SCAN_TASK,
      queue: 'maintenance',
      attempts: 1,
      everyMs: this.config.overdueScanIntervalSeconds * 1000,
      run: async () => {
        const notified = await this.scan();
        if (notified > 0) {
          this.logger.log(`Overdue scan: ${notified} order(s) notified`);
        }
      },
    });
  }

  /** One pass over every active organization. Returns the number of orders notified. */
  async scan(now: Date = new Date()): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const organizations = await this.prisma.organization.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, timeZone: true, currency: true },
      });
      let notified = 0;
      for (const organization of organizations) {
        notified += await this.scanOrganization(organization, now);
      }
      return notified;
    } finally {
      this.running = false;
    }
  }

  private async scanOrganization(
    organization: { id: string; timeZone: string; currency: string },
    now: Date,
  ): Promise<number> {
    const today = dateOnly(calendarDate(now, organization.timeZone));
    const due = await this.prisma.order.findMany({
      where: {
        organizationId: organization.id,
        status: { not: 'CANCELLED' },
        dueDate: { lt: today },
        overdueNotifiedAt: null,
        paidAmount: { lt: this.prisma.order.fields.totalAmount },
      },
      include: { shop: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
      take: BATCH,
    });

    let notified = 0;
    for (const order of due) {
      const outstanding = toAmount(order.totalAmount - order.paidAmount);
      const claimed = await this.prisma.$transaction(async tx => {
        const { count } = await tx.order.updateMany({
          where: { id: order.id, overdueNotifiedAt: null },
          data: { overdueNotifiedAt: now },
        });
        if (count === 0) {
          return false;
        }
        await writeAudit(tx, {
          organizationId: organization.id,
          actorId: null,
          action: 'payment.overdue_notified',
          entityType: 'order',
          entityId: order.id,
          summary: `${order.shop.name}: ${formatMoney(
            outstanding,
            organization.currency,
          )} overdue on ${order.orderNumber}`,
          data: {
            outstanding,
            dueDate: order.dueDate.toISOString().slice(0, 10),
          },
        });
        return true;
      });
      if (!claimed) {
        continue;
      }
      notified += 1;
      this.events.publish({
        type: 'payment.overdue',
        organizationId: organization.id,
        shopId: order.shop.id,
        shopName: order.shop.name,
        orderId: order.id,
        orderNumber: order.orderNumber,
        outstanding,
        currency: organization.currency,
        recipientIds: await this.access.shopStakeholders(
          organization.id,
          order.shopId,
        ),
      });
    }
    return notified;
  }
}
