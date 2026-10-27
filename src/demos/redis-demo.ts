import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => unknown;

export class Checks {
    private failures: string[] = [];

    constructor(readonly name: string) {}

    print(summary: Record<string, string | number>): void {
        for (const [k, v] of Object.entries(summary)) console.log(`${k}=${v}`);
    }

    expect(condition: boolean, message: string): void {
        if (!condition) this.failures.push(message);
    }

    finish(): never {
        if (this.failures.length) {
            this.failures.forEach((f) => console.error(`INVARIANT VIOLATED: ${f}`));
            process.exit(1);
        }
        console.log(`# ${this.name}: OK`);
        process.exit(0);
    }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const demoTag = () => `${Date.now().toString(36)}-${process.pid}`;

export async function listen(
    middleware: Middleware,
    handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void middleware(req, res, (err) => {
            if (err) {
                res.statusCode = 500;
                res.end(String(err));
                return;
            }
            handler(req, res);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${port}` };
}

export function close(server: Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

export function run(main: () => Promise<void>): void {
    main().catch((e) => {
        console.error(`demo failed: ${(e as Error).message}`);
        process.exit(1);
    });
}
