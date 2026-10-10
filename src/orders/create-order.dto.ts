import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

export class OrderItemDto {
    @IsInt()
    @Min(1)
    productId: number;

    @IsInt()
    @Min(1)
    quantity: number;
}

export class CreateOrderDto {
    @IsInt()
    @Min(1)
    buyerId: number;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => OrderItemDto)
    items: OrderItemDto[];
}
