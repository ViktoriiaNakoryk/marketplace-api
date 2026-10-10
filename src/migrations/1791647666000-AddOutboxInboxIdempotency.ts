import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOutboxInboxIdempotency1791647666000 implements MigrationInterface {
    name = 'AddOutboxInboxIdempotency1791647666000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "outbox" ("id" uuid NOT NULL, "aggregatetype" text NOT NULL, "aggregateid" text NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT 0, "last_error" text, CONSTRAINT "PK_outbox" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_outbox_unpublished" ON "outbox" ("created_at", "id") WHERE "published_at" IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_outbox_aggregate" ON "outbox" ("aggregatetype", "aggregateid")`);
        await queryRunner.query(`CREATE TABLE "processed_messages" ("message_id" text NOT NULL, "consumer" text NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer"))`);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("key" text NOT NULL, "request_fingerprint" text NOT NULL, "order_id" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key"), CONSTRAINT "FK_idempotency_keys_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP TABLE "processed_messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_outbox_aggregate"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_outbox_unpublished"`);
        await queryRunner.query(`DROP TABLE "outbox"`);
    }

}
