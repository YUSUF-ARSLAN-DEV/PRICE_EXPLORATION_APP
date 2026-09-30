/** API contracts shared by the API, web, admin and tests (zod = single source of truth). */
import { z } from 'zod';

export const uuid = z.string().uuid();
export const localeSchema = z.enum(['en', 'ar']);

// ---- auth / account ---------------------------------------------------------------------------
export const CONSENT_PURPOSES = [
  'account_terms',
  'history',
  'alerts_email',
  'contribute_receipts',
  'analytics',
  'area_sync',
] as const;
export const consentPurpose = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = z.infer<typeof consentPurpose>;

export const passwordSchema = z
  .string()
  .min(10, 'at least 10 characters')
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'must contain letters and digits');

export const registerBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  locale: localeSchema.default('en'),
  /** Must be true: "I am 18+ and accept the Terms and Privacy Notice" (consent text v0.1). */
  acceptTerms: z.literal(true),
  consentVersion: z.string().min(1).max(20).default('v0.1'),
});
export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
export const tokenBody = z.object({ token: z.string().min(20).max(600) });
export const forgotBody = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetBody = z.object({ token: z.string().min(20).max(600), password: passwordSchema });
export const updateMeBody = z.object({ locale: localeSchema.optional() });
export const consentsBody = z.object({
  consents: z
    .array(z.object({ purpose: consentPurpose, granted: z.boolean() }))
    .min(1)
    .max(6),
  version: z.string().min(1).max(20).default('v0.1'),
});
export const deleteMeBody = z.object({ password: z.string().min(1).max(128) });

// ---- catalogue / search -----------------------------------------------------------------------
export const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  lang: localeSchema.default('en'),
  category: z.string().max(80).optional(),
  retailer: z.string().max(80).optional(),
  sort: z.enum(['relevance', 'price', 'unit_price']).default('relevance'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});
export type SearchQuery = z.infer<typeof searchQuery>;

export const autocompleteQuery = z.object({
  q: z.string().trim().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(10).default(8),
});

export interface Offer {
  offer_id: string;
  retailer_id: string;
  retailer_slug: string;
  retailer_name_en: string;
  retailer_name_ar: string | null;
  branch_name: string | null;
  branch_area: string | null;
  price_qar: number;
  was_price_qar: number | null;
  promo_type: string;
  promo_ends_at: string | null;
  in_stock: boolean;
  unit_price_qar: number | null;
  unit_price_base: string | null;
  observed_at: string;
  is_stale: boolean;
}

export interface ProductResult {
  id: string;
  name_en: string;
  name_ar: string | null;
  brand: string | null;
  category_slug: string | null;
  size_value: number | null;
  size_unit: string | null;
  pack_count: number;
  offers: Offer[];
  offer_count: number;
  min_price_qar: number | null;
  max_price_qar: number | null;
  last_updated: string | null;
}

export interface SearchResponse {
  query: string;
  backend: 'postgres' | 'meilisearch';
  total: number;
  results: ProductResult[];
  disclaimer: string;
}

// ---- baskets ----------------------------------------------------------------------------------
export const basketItem = z.object({
  product_id: uuid,
  quantity: z.number().positive().max(999).default(1),
});
export const optimiseBody = z.object({
  items: z.array(basketItem).min(1).max(100),
  allow_split: z.boolean().default(true),
  /** QAR added per extra store visited when comparing a split against a single store. */
  split_penalty_qar: z.number().min(0).max(500).default(0),
});
export const saveBasketBody = z.object({
  name: z.string().trim().min(1).max(60),
  items: z.array(basketItem).max(100),
});

export interface BasketPlan {
  stores: {
    retailer_id: string;
    retailer_slug: string;
    retailer_name_en: string;
    total_qar: number;
    items: number;
  }[];
  best_single: { retailer_id: string; total_qar: number; missing_product_ids: string[] } | null;
  best_split: {
    total_qar: number;
    penalty_qar: number;
    assignments: { product_id: string; retailer_id: string; price_qar: number; quantity: number }[];
  } | null;
  unavailable_product_ids: string[];
}

// ---- alerts / reports -------------------------------------------------------------------------
export const alertBody = z.object({
  product_id: uuid,
  threshold_qar: z.number().positive().max(5000),
});
export const reportBody = z.object({
  product_id: uuid,
  retailer_id: uuid,
  branch_id: uuid.optional(),
  price_qar: z.coerce.number().positive().max(5000),
});

// ---- admin ------------------------------------------------------------------------------------
export const sourceChangeBody = z.object({
  reason: z.string().trim().min(5).max(500),
  change: z
    .object({
      legal_status: z.enum(['green', 'amber', 'red', 'disabled']).optional(),
      approval_ref: z.string().max(300).optional(),
      tos_archive_url: z.string().max(500).optional(),
      robots_archive_url: z.string().max(500).optional(),
      refresh_cron: z.string().max(100).optional(),
    })
    .strict()
    .refine((c) => Object.keys(c).length > 0, 'empty change'),
});
export const killSwitchBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const decideMatchBody = z.object({ product_id: uuid });
export const mergeBody = z.object({ keep: uuid, drop: uuid });
export const takedownBody = z.object({
  retailer_id: uuid.optional(),
  source_id: uuid.optional(),
  requester_name: z.string().max(200).optional(),
  requester_email: z.string().email().max(254).optional(),
  channel: z.enum(['email', 'web_form', 'letter', 'other']).default('email'),
  summary: z.string().trim().min(5).max(2000),
});
export const resolveTakedownBody = z.object({
  action: z.enum([
    'source_disabled',
    'price_corrected',
    'content_hidden',
    'rejected',
    'forwarded_to_counsel',
  ]),
  notes: z.string().max(2000).optional(),
});
export const publicTakedownBody = takedownBody
  .pick({ requester_name: true, requester_email: true, summary: true })
  .extend({
    requester_email: z.string().email().max(254),
  });

export const DISCLAIMER_EN =
  'Prices come from retailers, partners and community reports and may change. Always check the price at the store or checkout.';
export const DISCLAIMER_AR =
  'الأسعار مصدرها المتاجر والشركاء وبلاغات المجتمع وقد تتغير. تحقق دائمًا من السعر في المتجر أو عند الدفع.';
