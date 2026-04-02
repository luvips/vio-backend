import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  // DataSource es provisto automáticamente por TypeOrmModule.forRoot en AppModule
  exports: [UsersService],
})
export class UsersModule {}
