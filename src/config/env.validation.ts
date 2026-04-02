import * as Joi from 'joi';

// Todos los campos son obligatorios al arrancar — las variables faltantes lanzan error antes de servir cualquier petición
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().uri().required(),
  JWT_PRIVATE_KEY_PATH: Joi.string().required(),
  JWT_PUBLIC_KEY_PATH: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  TMDB_API_KEY: Joi.string().required(),
  TMDB_BASE_URL: Joi.string().uri().default('https://api.themoviedb.org/3'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  ALLOWED_ORIGINS: Joi.string().required(),
});
