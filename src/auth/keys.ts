import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

export const JWT_ALGORITHMS = ['ES256'] as const;
export const JWT_ISSUER = 'marketplace-api';
export const JWT_AUDIENCE = 'marketplace-api';

function pem(base64: string): string {
    return Buffer.from(base64, 'base64').toString('utf8');
}

function assertP256(key: KeyObject): KeyObject {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error(`expected an EC P-256 key for ES256, got ${key.asymmetricKeyType}`);
    }
    return key;
}

export function loadPrivateKey(base64: string): KeyObject {
    return assertP256(createPrivateKey(pem(base64)));
}

export function loadPublicKey(base64: string): KeyObject {
    return assertP256(createPublicKey(pem(base64)));
}

export function fingerprint(key: KeyObject): string {
    const publicKey = key.type === 'private' ? createPublicKey(key) : key;
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return `sha256:${createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
}
