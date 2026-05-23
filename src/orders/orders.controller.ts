import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  getOrder(@Param('id') orderId: string) {
    return this.orders.getOrder(orderId);
  }
}
