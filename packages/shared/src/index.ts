import { z } from 'zod';

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Shape of the GET /health response shared by api + clients. */
export const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

/** Prices are QAR, two decimals (plan 2.3). */
export const QarPrice = z.number().nonnegative().multipleOf(0.01);

export * from './normalize';
export * from './size';

export * from './api';
export * from './basket';
