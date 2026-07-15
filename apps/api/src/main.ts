import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { readFileSync } from "fs";
import { AppModule } from "./app.module";

async function bootstrap() {
  const httpsKeyPath = process.env.HTTPS_KEY || "/tmp/localhost-key.pem";
  const httpsCertPath = process.env.HTTPS_CERT || "/tmp/localhost-cert.pem";

  let httpsOptions: { key: string; cert: string } | undefined;
  try {
    httpsOptions = {
      key: readFileSync(httpsKeyPath, "utf-8"),
      cert: readFileSync(httpsCertPath, "utf-8"),
    };
  } catch {
    // No cert files found — fall back to HTTP
  }

  const app = await NestFactory.create(AppModule, httpsOptions ? { httpsOptions } : {});

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  const proto = httpsOptions ? 'https' : 'http';
  console.log(`API running on ${proto}://localhost:${port}`);
}

bootstrap();
