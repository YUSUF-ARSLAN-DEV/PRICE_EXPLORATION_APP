import { applyDecorators, PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Validates and transforms a body/query/param with a zod schema. ZodError => 422 problem. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}

export const toJsonSchema = (schema: ZodTypeAny) =>
  zodToJsonSchema(schema as never, { target: 'openApi3', $refStrategy: 'none' }) as Record<
    string,
    unknown
  >;

/** Documents a zod-validated JSON body in the OpenAPI spec. */
export const ApiZodBody = (schema: ZodTypeAny) => ApiBody({ schema: toJsonSchema(schema) });

/** Documents the properties of a zod object as query parameters. */
export const ApiZodQuery = (schema: z.ZodObject<z.ZodRawShape>) => {
  const json = toJsonSchema(schema) as { properties?: Record<string, object>; required?: string[] };
  const decorators = Object.entries(json.properties ?? {}).map(([name, s]) =>
    ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: s as never }),
  );
  return applyDecorators(...decorators);
};
