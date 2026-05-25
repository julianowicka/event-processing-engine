import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { OrderDetailsResponse } from './orders.types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id')
  getOrder(@Param('id') id: string): Promise<OrderDetailsResponse> {
    return this.ordersService.getOrderDetails(id);
  }
}
