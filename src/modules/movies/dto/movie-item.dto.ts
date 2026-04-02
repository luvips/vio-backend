import { IsInt, IsPositive } from 'class-validator';

export class MovieItemDto {
  // @IsInt + @IsPositive rechaza cadenas, flotantes e IDs negativos — previene peticiones malformadas a TMDB
  @IsInt()
  @IsPositive()
  tmdb_id: number;
}
