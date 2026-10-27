import { z } from 'zod';
import { loadPrivateKey, loadPublicKey } from '../auth/keys';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const pemKey = (load: (b64: string) => unknown) =>
    z.string().min(1).superRefine((value, ctx) => {
        try {
            load(value);
        } catch (e) {
            ctx.addIssue({ code: 'custom', message: `не base64 PEM-ключ EC P-256 (${(e as Error).message})` });
        }
    });

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DB_URL: z.url({ protocol: /^postgres$/ }),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DB_PASSWORD_FILE: z.string().default('./secrets/db_password'),
    BROKER_URL: z.url({ protocol: /^amqps?$/ }).optional(),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    REDIS_QUEUE_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(100),
    JWT_KID: z.string().min(1),
    JWT_PRIVATE_KEY: pemKey(loadPrivateKey),
    JWT_PUBLIC_KEY: pemKey(loadPublicKey),
    JWT_PREVIOUS_KID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    JWT_PREVIOUS_PUBLIC_KEY: z.preprocess(emptyToUndefined, pemKey(loadPublicKey).optional()),
    REFRESH_TOKEN_PEPPER: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
    const parsed = envSchema.safeParse(raw);
    if (!parsed.success) {
        const lines = parsed.error.issues
            .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n');
        throw new Error(`Невалідна конфігурація:\n${lines}\nПорівняй свій .env з .env.example.`);
    }
    return parsed.data;
}
