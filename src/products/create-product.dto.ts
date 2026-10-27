import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
    @IsString()
    @MinLength(1)
    sku: string;

    @IsString()
    @MinLength(1)
    name: string;

    @IsString()
    description: string;

    @IsString()
    @MinLength(1)
    category: string;

    @IsString()
    @MinLength(1)
    brand: string;

    @IsInt()
    @Min(1)
    price: number;

    @IsInt()
    @Min(0)
    stock: number;
}
