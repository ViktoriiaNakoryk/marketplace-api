import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
    new Promise<Buffer>((resolve, reject) =>
        scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
    );

const N = 16384;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, KEYLEN, { N });
    return `scrypt$${N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
    const [scheme, n, salt, hash] = (stored ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$').split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash ?? '', 'base64url');
    const actual = await scrypt(password, Buffer.from(salt, 'base64url'), KEYLEN, { N: Number(n) });
    return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}
