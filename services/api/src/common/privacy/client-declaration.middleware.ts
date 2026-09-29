import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { readClientDeclaration, runWithClientDeclaration } from './client-declaration'

@Injectable()
export class ClientDeclarationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    runWithClientDeclaration(readClientDeclaration(req.headers), () => next())
  }
}
