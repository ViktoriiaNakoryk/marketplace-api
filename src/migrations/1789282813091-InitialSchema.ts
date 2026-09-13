import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1789282813091 implements MigrationInterface {
    name = 'InitialSchema1789282813091'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "orders" ("id" BIGSERIAL NOT NULL, "status" text NOT NULL, "total" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "buyerId" bigint NOT NULL, CONSTRAINT "CHK_d730c4fdae6eee5bf91d7b4f61" CHECK ("total" >= 0), CONSTRAINT "CHK_3ea10ef712f3cc2a3083c6a902" CHECK ("status" IN ('pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9877ffd9a491c3e82f5b32d4f4" ON "orders" ("buyerId") `);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" BIGSERIAL NOT NULL, "quantity" integer NOT NULL, "unitPrice" integer NOT NULL, "orderId" bigint NOT NULL, "productId" bigint NOT NULL, CONSTRAINT "CHK_15eb8ea9e6067cd80b96671530" CHECK ("unitPrice" > 0), CONSTRAINT "CHK_6e5d794f7711186091b3156024" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`, ["marketplace","public","products","GENERATED_COLUMN","searchVector","to_tsvector('simple', name || ' ' || description)"]);
        await queryRunner.query(`CREATE TABLE "products" ("id" BIGSERIAL NOT NULL, "sku" text NOT NULL, "name" text NOT NULL, "description" text NOT NULL, "category" text NOT NULL, "brand" text NOT NULL, "price" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED, "sellerId" bigint NOT NULL, CONSTRAINT "UQ_c44ac33a05b144dd0d9ddcf9327" UNIQUE ("sku"), CONSTRAINT "CHK_a5356b1aa4216c02c814622238" CHECK ("price" > 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e40a1dd2909378f0da1f34f7bd" ON "products" ("sellerId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c3932231d2385ac248d0888d95" ON "products" ("category") `);
        await queryRunner.query(`CREATE INDEX "idx_products_search_vector" ON "products" USING GIN ("searchVector")`);
        await queryRunner.query(`CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "email" text NOT NULL, "fullName" text NOT NULL, "role" text NOT NULL DEFAULT 'buyer', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "CHK_d3f6c6c9186422525e27964c89" CHECK ("role" IN ('buyer', 'seller', 'admin')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_9877ffd9a491c3e82f5b32d4f4d" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_f1d359a55923bb45b057fbdab0d" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_cdb99c05982d5191ac8465ac010" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_e40a1dd2909378f0da1f34f7bd6" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_e40a1dd2909378f0da1f34f7bd6"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_cdb99c05982d5191ac8465ac010"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_f1d359a55923bb45b057fbdab0d"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_9877ffd9a491c3e82f5b32d4f4d"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c3932231d2385ac248d0888d95"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e40a1dd2909378f0da1f34f7bd"`);
        await queryRunner.query(`DROP INDEX "public"."idx_products_search_vector"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`, ["GENERATED_COLUMN","searchVector","marketplace","public","products"]);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9877ffd9a491c3e82f5b32d4f4"`);
        await queryRunner.query(`DROP TABLE "orders"`);
    }

}
