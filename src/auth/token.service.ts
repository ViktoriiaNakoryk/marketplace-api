import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import type { KeyObject } from 'node:crypto';
import { Env } from '../config/env.schema';
import type { Role } from '../users/users.repository';
import { fingerprint, JWT_ALGORITHMS, JWT_AUDIENCE, JWT_ISSUER, loadPrivateKey, loadPublicKey } from './keys';

export const ACCESS_TTL_SEC = 10 * 60;

export type AccessClaims = { sub: number; role: Role; sid: string; jti: string; exp: number };

export type SignedAccess = { token: string; jti: string; exp: number };

@Injectable()
export class TokenService {
    private readonly signingKey: KeyObject;
    private readonly kid: string;
    private readonly verificationKeys = new Map<string, KeyObject>();

    constructor(config: ConfigService<Env, true>) {
        this.kid = config.get('JWT_KID', { infer: true });
        this.signingKey = loadPrivateKey(config.get('JWT_PRIVATE_KEY', { infer: true }));
        this.verificationKeys.set(this.kid, loadPublicKey(config.get('JWT_PUBLIC_KEY', { infer: true })));

        const previousKid = config.get('JWT_PREVIOUS_KID', { infer: true });
        const previousKey = config.get('JWT_PREVIOUS_PUBLIC_KEY', { infer: true });
        if (previousKid && previousKey) this.verificationKeys.set(previousKid, loadPublicKey(previousKey));

        const keys = [...this.verificationKeys].map(([kid, key]) => `${kid}=${fingerprint(key)}`).join(' ');
        console.log(`[auth] signing kid=${this.kid} ${fingerprint(this.signingKey)}; verifying ${keys}`);
    }

    sign(user: { id: number; role: Role }, familyId: string): SignedAccess {
        const jti = randomUUID();
        const token = jwt.sign({ role: user.role, sid: familyId }, this.signingKey, {
            algorithm: JWT_ALGORITHMS[0],
            keyid: this.kid,
            subject: String(user.id),
            jwtid: jti,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            expiresIn: ACCESS_TTL_SEC,
        });
        return { token, jti, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC };
    }

    verify(token: string): Promise<AccessClaims> {
        return new Promise((resolve, reject) => {
            jwt.verify(
                token,
                (header: JwtHeader, done) => {
                    const key = header.kid ? this.verificationKeys.get(header.kid) : undefined;
                    if (key) done(null, key);
                    else done(new Error(`unknown kid ${header.kid}`));
                },
                {
                    algorithms: [...JWT_ALGORITHMS],
                    issuer: JWT_ISSUER,
                    audience: JWT_AUDIENCE,
                },
                (err, decoded) => {
                    if (err) return reject(err);
                    const p = decoded as JwtPayload;
                    if (!p.sub || !p.jti || !p.sid || !p.role || !p.exp) return reject(new Error('missing claims'));
                    resolve({ sub: Number(p.sub), role: p.role as Role, sid: String(p.sid), jti: p.jti, exp: p.exp });
                },
            );
        });
    }
}
