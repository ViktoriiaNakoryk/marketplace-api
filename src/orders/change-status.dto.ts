import { IsIn } from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from './orders.repository';

export class ChangeStatusDto {
    @IsIn(ORDER_STATUSES)
    status: OrderStatus;
}
