import { Controller, Get } from '@nestjs/common';
import { buildOpenApiDocument } from '@frs/contracts';

@Controller()
export class OpenApiController {
  @Get('openapi.json')
  document(): Record<string, unknown> {
    return buildOpenApiDocument();
  }
}
