import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStockBalanceJobs1789286455673 implements MigrationInterface {
    name = 'AddStockBalanceJobs1789286455673'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "jobs" ("id" BIGSERIAL NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "status" text NOT NULL DEFAULT 'pending', "processed" integer NOT NULL DEFAULT '0', "worker" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_142f096b9f94ca3950f99849de" CHECK ("status" IN ('pending', 'done', 'failed')), CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a0c30e3eb9649fe7fbcd336a63" ON "jobs" ("status") `);
        await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "balance" bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "CHK_aea3ee263e1d44e36e5f5b5783" CHECK ("stock" >= 0)`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_c02441849c51cb89e480be94b1" CHECK ("balance" >= 0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_c02441849c51cb89e480be94b1"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "CHK_aea3ee263e1d44e36e5f5b5783"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0c30e3eb9649fe7fbcd336a63"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
    }

}
