import {
    CanActivate,
    createParamDecorator,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    SetMetadata,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Role } from '../users/users.repository';
import { AuthService } from './auth.service';
import { type AccessClaims, TokenService } from './token.service';

export type AuthedRequest = Request & { user?: AccessClaims };

const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AccessClaims => ctx.switchToHttp().getRequest<AuthedRequest>().user!,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly tokens: TokenService,
        private readonly auth: AuthService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<AuthedRequest>();
        const res = context.switchToHttp().getResponse<Response>();
        const [scheme, token] = (req.headers.authorization ?? '').split(' ');
        if (scheme !== 'Bearer' || !token) {
            res.setHeader('WWW-Authenticate', 'Bearer');
            throw new UnauthorizedException('Missing bearer token');
        }
        let claims: AccessClaims;
        try {
            claims = await this.tokens.verify(token);
        } catch {
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
            throw new UnauthorizedException('Invalid or expired token');
        }
        if (await this.auth.isRevoked(claims)) {
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
            throw new UnauthorizedException('Token has been revoked');
        }
        req.user = claims;
        return true;
    }
}

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
        if (!roles?.length) return true;
        const user = context.switchToHttp().getRequest<AuthedRequest>().user;
        if (!user) throw new UnauthorizedException();
        if (!roles.includes(user.role)) throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
        return true;
    }
}
