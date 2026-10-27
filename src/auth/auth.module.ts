import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { TokenService } from './token.service';

@Global()
@Module({
    imports: [DatabaseModule],
    controllers: [AuthController],
    providers: [TokenService, AuthService, JwtAuthGuard, RolesGuard],
    exports: [TokenService, AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
