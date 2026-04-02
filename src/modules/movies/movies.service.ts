import { Injectable, NotFoundException, BadGatewayException, Inject, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './entities/favorite.entity';
import { WatchLater } from './entities/watch-later.entity';
import { firstValueFrom, catchError, retry, timer } from 'rxjs';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { createHash } from 'crypto';

// CERRADO: operación normal | ABIERTO: llamadas rechazadas | SEMIABIERTO: se permite una llamada de prueba
enum CircuitState { CLOSED = 'CLOSED', OPEN = 'OPEN', HALF_OPEN = 'HALF_OPEN' }

@Injectable()
export class MoviesService {
  private readonly logger = new Logger(MoviesService.name);
  private tmdbBaseUrl: string;
  private tmdbApiKey: string;

  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;

  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT = 30000;
  private readonly RETRY_ATTEMPTS = 2;
  private readonly CACHE_TTL = 300;
  private readonly STALE_CACHE_TTL = 3600;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Favorite) private readonly favoriteRepository: Repository<Favorite>,
    @InjectRepository(WatchLater) private readonly watchLaterRepository: Repository<WatchLater>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.tmdbBaseUrl = this.configService.get('TMDB_BASE_URL')!;
    this.tmdbApiKey = this.configService.get('TMDB_API_KEY')!;
  }

  async searchMovies(query: string) {
    if (!query) return [];
    // SHA-256 de la query normalizada  garantiza que la clave solo tenga caracteres hex,
    // evitando inyección de caracteres especiales de Redis (*, \n, :) sin importar qué busque el usuario
    const queryHash = createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
    return this.fetchWithResilience(`tmdb:search:${queryHash}`, `${this.tmdbBaseUrl}/search/movie`, {
      api_key: this.tmdbApiKey,
      query: query.trim(),
    });
  }

  async getMovieById(id: number) {
    return this.fetchWithResilience(`tmdb:movie:${id}`, `${this.tmdbBaseUrl}/movie/${id}`, {
      api_key: this.tmdbApiKey,
    });
  }

  // Orden de prioridad: caché fresca  interruptor de circuito HTTP con reintentos  caché antigua  error
  private async fetchWithResilience(cacheKey: string, url: string, params: Record<string, any>) {
    const cached = await this.cacheManager.get<any>(cacheKey);
    if (cached) return cached;

    if (!this.isCircuitAllowing()) return this.getStaleOrFail(cacheKey);

    try {
      const data = await this.fetchFromTMDB(url, params);
      this.onSuccess();
      await this.cacheManager.set(cacheKey, data, this.CACHE_TTL * 1000);
      // Copia antigua con TTL más largo  se usa como respaldo cuando el circuito está abierto
      await this.cacheManager.set(`${cacheKey}:stale`, data, this.STALE_CACHE_TTL * 1000);
      return data;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.onFailure();
      return this.getStaleOrFail(cacheKey);
    }
  }

  private isCircuitAllowing(): boolean {
    if (this.circuitState === CircuitState.CLOSED) return true;
    if (this.circuitState === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.RECOVERY_TIMEOUT) {
        this.circuitState = CircuitState.HALF_OPEN;
        return true;
      }
      return false;
    }
    return true; // SEMIABIERTO: se deja pasar una llamada de prueba
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.circuitState = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.FAILURE_THRESHOLD || this.circuitState === CircuitState.HALF_OPEN) {
      this.circuitState = CircuitState.OPEN;
      this.logger.error(`Interruptor de circuito ABIERTO: ${this.failureCount} fallos consecutivos. Bloqueando llamadas por ${this.RECOVERY_TIMEOUT / 1000}s`);
    }
  }

  private async getStaleOrFail(cacheKey: string) {
    const stale = await this.cacheManager.get<any>(`${cacheKey}:stale`);
    if (stale) return { ...stale, _stale: true, _notice: 'Los datos pueden estar desactualizados por problemas con el servicio externo' };
    throw new BadGatewayException('Servicio externo no disponible y sin datos en caché');
  }

  private async fetchFromTMDB(url: string, params: Record<string, any>) {
    const { data } = await firstValueFrom(
      this.httpService.get(url, { params, timeout: 5000 }).pipe(
        retry({
          count: this.RETRY_ATTEMPTS,
          delay: (_err, retryCount) => timer(retryCount * 1000), // espera progresiva: 1s, 2s
        }),
        catchError((error) => {
          if (error.response?.status === 404) throw new NotFoundException('Película no encontrada');
          // Nunca se expone el error original de Axios al cliente
          throw new BadGatewayException('Servicio externo no disponible');
        }),
      ),
    );
    return data;
  }

  async addFavorite(userId: string, tmdb_id: number) {
    try {
      await this.favoriteRepository.save(this.favoriteRepository.create({ user: { id: userId }, tmdb_id }));
      return { success: true, message: 'Añadido a favoritos' };
    } catch (error: any) {
      // La restricción única de la BD (23505) se convierte en respuesta idempotente en lugar de 409
      if (error.code === '23505') return { success: true, message: 'Ya está en favoritos' };
      throw error;
    }
  }

  async addWatchLater(userId: string, tmdb_id: number) {
    try {
      await this.watchLaterRepository.save(this.watchLaterRepository.create({ user: { id: userId }, tmdb_id }));
      return { success: true, message: 'Añadido a ver más tarde' };
    } catch (error: any) {
      if (error.code === '23505') return { success: true, message: 'Ya está en la lista de ver más tarde' };
      throw error;
    }
  }
}
