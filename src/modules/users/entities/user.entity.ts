import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('users')
export class User {
  // UUID evita que un atacante enumere IDs secuenciales a través de la API
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  // @Exclude hace que ClassSerializerInterceptor lo quite de todas las respuestas JSON
  @Exclude()
  @Column()
  password_hash: string;

  // null significa sin sesión activa (logout o sesión invalidada por detección de robo de token)
  // type: 'varchar' es explícito porque TypeScript infiere `string | null` como "Object" en TypeORM
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  refresh_token_hash: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
