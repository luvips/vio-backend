import { IsEmail, IsStrongPassword } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  // Mínimo 8 chars, 1 mayúscula, 1 número, 1 símbolo — se rechaza en el borde sin llegar al servicio
  @IsStrongPassword({ minLength: 8, minUppercase: 1, minNumbers: 1, minSymbols: 1 })
  password: string;
}
