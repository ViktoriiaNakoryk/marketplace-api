import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { CurrentUser, JwtAuthGuard } from './guards';
import type { AccessClaims } from './token.service';

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(1)
    password: string;
}

export class RefreshDto {
    @IsString()
    @MinLength(1)
    refreshToken: string;
}

@Controller('auth')
export class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Post('login')
    @HttpCode(200)
    login(@Body() body: LoginDto) {
        return this.auth.login(body.email, body.password);
    }

    @Post('refresh')
    @HttpCode(200)
    refresh(@Body() body: RefreshDto) {
        return this.auth.refresh(body.refreshToken);
    }

    @Post('logout')
    @HttpCode(204)
    @UseGuards(JwtAuthGuard)
    async logout(@CurrentUser() user: AccessClaims) {
        await this.auth.logout(user);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    me(@CurrentUser() user: AccessClaims) {
        return { id: user.sub, role: user.role };
    }
}
