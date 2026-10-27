import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Redis from 'ioredis';

export type SessionData = { userId: number | null; createdAt: number };

export type Session = { id: string; data: SessionData };

export class SessionStore {
    constructor(
        private readonly redis: Redis,
        readonly ttlSec = 1800,
    ) {}

    key(id: string): string {
        return `sess:${id}`;
    }

    async create(data: Partial<SessionData> = {}): Promise<Session> {
        const id = randomBytes(24).toString('base64url');
        const session: SessionData = { userId: null, createdAt: Date.now(), ...data };
        await this.redis.set(this.key(id), JSON.stringify(session), 'EX', this.ttlSec, 'NX');
        return { id, data: session };
    }

    async touch(id: string): Promise<Session | null> {
        const raw = await this.redis.getex(this.key(id), 'EX', this.ttlSec);
        return raw ? { id, data: JSON.parse(raw) as SessionData } : null;
    }

    async destroy(id: string): Promise<void> {
        await this.redis.del(this.key(id));
    }
}

export type SessionRequest = IncomingMessage & { session?: Session };

function readCookie(req: IncomingMessage, name: string): string | undefined {
    const header = req.headers.cookie ?? '';
    for (const part of header.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('='));
    }
    return undefined;
}

export function sessionMiddleware(store: SessionStore, cookieName = 'sid') {
    return async (req: SessionRequest, res: ServerResponse, next: (err?: unknown) => void): Promise<void> => {
        try {
            const id = readCookie(req, cookieName);
            let session = id ? await store.touch(id) : null;
            if (!session) session = await store.create();
            res.setHeader(
                'Set-Cookie',
                `${cookieName}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${store.ttlSec}`,
            );
            req.session = session;
            next();
        } catch (e) {
            next(e);
        }
    };
}
