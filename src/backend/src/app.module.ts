import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { ListingsModule } from './modules/listings/listings.module';
import { AssociatesModule } from './modules/associates/associates.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ReferralsModule } from './modules/referrals/referrals.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      username: process.env.DB_USERNAME || 'kwsa_user',
      password: process.env.DB_PASSWORD || 'kwsa_password',
      database: process.env.DB_NAME || 'kwsa_dev',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
    }),
    AuthModule,
    ListingsModule,
    AssociatesModule,
    TransactionsModule,
    ReferralsModule,
  ],
})
export class AppModule {}