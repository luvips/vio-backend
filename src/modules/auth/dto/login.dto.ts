import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  // Solo @IsString — sin reglas de política para que el mensaje de error no revele qué formato
  // tiene una contraseña válida, lo que facilitaría ataques de credential stuffing
  @IsString()
  password: string;
}
