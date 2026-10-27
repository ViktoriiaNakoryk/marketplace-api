import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuth1793145600000 implements MigrationInterface {
    name = 'AddAuth1793145600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" text`);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL, "user_id" bigint NOT NULL, "family_id" uuid NOT NULL, "parent_id" uuid, "token_hash" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"), CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "FK_refresh_tokens_parent" FOREIGN KEY ("parent_id") REFERENCES "refresh_tokens"("id") ON DELETE CASCADE)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_refresh_tokens_hash" ON "refresh_tokens" ("token_hash")`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_family" ON "refresh_tokens" ("family_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_user" ON "refresh_tokens" ("user_id")`);
        await queryRunner.query(`CREATE TABLE "access_token_denylist" ("jti" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_access_token_denylist" PRIMARY KEY ("jti"))`);
        await queryRunner.query(`CREATE INDEX "IDX_access_token_denylist_expires" ON "access_token_denylist" ("expires_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "access_token_denylist"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
    }

}
