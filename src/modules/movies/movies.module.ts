import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { MoviesService } from './movies.service';
import { MoviesController } from './movies.controller';
import { Favorite } from './entities/favorite.entity';
import { WatchLater } from './entities/watch-later.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Favorite, WatchLater]),
    // Control contra ataques de TimeOut si TMDB tarda (Performance y Security)
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 3,
    }),
    // Optimización de lecturas al cachear respuestas de TMDB
    CacheModule.register(),
    AuthModule, // Dependencia para el JwtAuthGuard
  ],
  controllers: [MoviesController],
  providers: [MoviesService],
})
export class MoviesModule {}
