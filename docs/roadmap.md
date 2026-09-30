# Roadmap after v1 (plan 11.5)

Nothing below is committed or scheduled. Order follows expected value to shoppers and legal risk: items that
need licences, messaging consent or new data categories come last. Each item needs a Change Log entry when it
starts, and legal review where noted.

| Horizon | Item | Notes / gate |
|---|---|---|
| Next | More stores via partner feeds | Needs signed terms per retailer (`docs/runbooks/retailer-onboarding.md`). Coverage is the product: nothing else matters if only two stores are live. |
| Next | Real gold set and matcher tuning | Replace the synthetic set with >= 1,000 hand-labelled pairs from real feeds; re-measure precision (target >= 98 %). |
| Next | Admin SSO + MFA (Entra) | Manual Azure step; blocks public launch. |
| Next | Receipt blurring of personal data | OCR redaction before storage; today receipts are kept <= 7 days and deleted. |
| Soon | Barcode scanner (web) | Camera permission, local decode only; barcode -> product match already possible via GTIN. |
| Soon | Price-drop alerts by web push | New consent purpose; service worker already exists; needs push-specific consent text. |
| Soon | Native apps (React Native) | Reuse `packages/shared`; store policies and PDPPL consent screens re-reviewed. |
| Later | More cities / delivery-app prices | Terms of each platform differ; partner route only. |
| Later | Pharmacy / household categories | Check licensing: medicines are regulated; keep the restricted-product exclusions. |
| Later | Loyalty-card prices | Only through a retailer partnership; never scrape member prices. |
| Later | Hindi / Urdu / Malayalam / Tagalog / Bengali UI | Translate with native review; add fonts; test RTL (Urdu) and complex scripts. |
| Later | WhatsApp bot | Check WhatsApp Business policy and PDPPL messaging consent first. |
| Later | Redis cache / rate limiting shared across replicas | ADR-009 deferred it: per-replica throttling is acceptable at launch size; revisit when replicas > 3 or p95 search > 150 ms under real load. |
| Later | OpenTelemetry tracing | ADR-012 deferred it; add when a cross-service latency problem cannot be explained from logs. |

## Known limitations of v1 (be honest about these on the methodology page)

- Prices come only from sources approved in the Source Registry; coverage is whatever has been agreed, not
  "every grocer in Qatar".
- Promotions are shown as reported by the source; multi-buy and loyalty deals are not combined into the
  basket optimiser.
- Branch-level prices exist in the data model but most sources supply one price per retailer.
- Arabic transliteration of brand names is handled by a dictionary; unusual spellings may miss a match.
