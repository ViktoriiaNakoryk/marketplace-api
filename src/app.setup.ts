import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp<T extends INestApplication>(app: T): T {
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    return app;
}
