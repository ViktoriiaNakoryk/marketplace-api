import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFulfillments1791646524270 implements MigrationInterface {
    name = 'AddFulfillments1791646524270'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "fulfillments" ("id" BIGSERIAL NOT NULL, "eventId" text NOT NULL, "status" text NOT NULL DEFAULT 'queued', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "orderId" bigint NOT NULL, CONSTRAINT "UQ_2f3853eda438f6232f0a28f5f11" UNIQUE ("orderId"), CONSTRAINT "UQ_43e922de9ec6811b3825fa2e3c6" UNIQUE ("eventId"), CONSTRAINT "CHK_e6331417c314078dfbf9db2dd5" CHECK ("status" IN ('queued', 'packed', 'shipped')), CONSTRAINT "PK_cb1805f0398d3d001737de76df3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "fulfillments" ADD CONSTRAINT "FK_2f3853eda438f6232f0a28f5f11" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fulfillments" DROP CONSTRAINT "FK_2f3853eda438f6232f0a28f5f11"`);
        await queryRunner.query(`DROP TABLE "fulfillments"`);
    }

}
