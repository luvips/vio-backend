import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

// Restricción única a nivel de BD  impide duplicados incluso bajo peticiones concurrentes
@Entity('favorites')
@Index(['user', 'tmdb_id'], { unique: true })
export class Favorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // CASCADE evita filas huérfanas si el usuario se elimina
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  tmdb_id: number;
}
