# Archived source terms (plan P2)

For every retailer considered, create `<retailer-slug>/` containing:

- `tos-YYYY-MM-DD.pdf` (or `.html`) - the Terms of Service as of that date
- `robots-YYYY-MM-DD.txt`
- `approval.md` - who approved (counsel / retailer email), date, scope, conditions
- `correspondence/` - partnership emails (keep out of public repos if confidential)

Nothing may be collected automatically from a retailer until `approval.md` exists and the
Source Registry row is `green`. Default for every source is `red`.
