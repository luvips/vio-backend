import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// El userId siempre sale del payload del JWT verificado que inyecta el guard —
// jamás del body ni de query params, donde el cliente podría manipularlo
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user?.sub;
});
