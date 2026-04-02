import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseIntPipe, UseInterceptors } from '@nestjs/common';
import { MoviesService } from './movies.service';
import { MovieItemDto } from './dto/movie-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';

@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  // Caché a nivel de petición: TTL de 300 segundos, ideal para búsquedas genéricas
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300 * 1000)
  @Get('search')
  async search(@Query('query') query: string) {
    return this.moviesService.searchMovies(query);
  }

  // Caché de detalles
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300 * 1000)
  @Get(':id')
  async getMovie(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.getMovieById(id);
  }

  // El userId viene exclusivamente del JWT verificado (@CurrentUser), nunca del cuerpo de la petición
  @UseGuards(JwtAuthGuard)
  @Post('favorites')
  async addToFavorites(
    @CurrentUser() userId: string,
    @Body() movieItemDto: MovieItemDto
  ) {
    return this.moviesService.addFavorite(userId, movieItemDto.tmdb_id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('watch-later')
  async addToWatchLater(
    @CurrentUser() userId: string,
    @Body() movieItemDto: MovieItemDto
  ) {
    return this.moviesService.addWatchLater(userId, movieItemDto.tmdb_id);
  }
}
