import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Verifier, VerifierOptions } from '@pact-foundation/pact';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PACT_FILE, PROVIDER } from './pact.config';
import { stateHandlers } from './provider-states';

function git(cmd: string, fallback: string): string {
    try {
        return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback;
    } catch {
        return fallback;
    }
}

describe('Pact verification: marketplace-api', () => {
    let app: INestApplication;
    let pool: Pool;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = configureApp(moduleRef.createNestApplication());
        await app.listen(0, '127.0.0.1');
        pool = new Pool({ connectionString: process.env.DB_URL });
    });

    afterAll(async () => {
        await pool.end();
        await app.close();
    });

    it('satisfies every consumer contract', async () => {
        const brokerUrl = process.env.PACT_BROKER_URL;
        const providerVersion = process.env.PACT_PROVIDER_VERSION || git('rev-parse --short HEAD', '0.0.0-local');

        const options: VerifierOptions = {
            provider: PROVIDER,
            providerBaseUrl: await app.getUrl(),
            providerVersion,
            providerVersionBranch: process.env.PACT_PROVIDER_BRANCH || git('rev-parse --abbrev-ref HEAD', 'local'),
            stateHandlers: stateHandlers(pool),
            logLevel: 'warn',
        };

        if (brokerUrl) {
            Object.assign(options, {
                pactBrokerUrl: brokerUrl,
                consumerVersionSelectors: [{ latest: true }],
                publishVerificationResult: true,
            });
            if (process.env.PACT_BROKER_TOKEN) options.pactBrokerToken = process.env.PACT_BROKER_TOKEN;
        } else {
            options.pactUrls = [PACT_FILE];
        }

        console.log(`verify: provider ${PROVIDER}@${providerVersion} against ${brokerUrl ?? PACT_FILE}`);
        await new Verifier(options).verifyProvider();
    });
});
