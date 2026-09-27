import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OverdueService } from './overdue.service.js';
import { ShopsController } from './shops.controller.js';
import { ShopsService } from './shops.service.js';

/**
 * Shops and their accounts: shops, shop assignments, orders, order items and payments. The
 * money rules live in ledger.ts, which the operations module also calls inside its own
 * transactions (a submitted collection records its payment atomically).
 */
@Module({
  imports: [CatalogModule],
  controllers: [ShopsController, OrdersController],
  providers: [ShopsService, OrdersService, OverdueService],
  exports: [ShopsService, OrdersService, OverdueService],
})
export class ShopsModule {}
