# Retailer onboarding and "claim your store" (plan 11.3)

**Who this is for:** whoever works the partnerships inbox and the admin console ("Retailer claims" queue).

A claim is a **request**, not an account. Submitting the form at `/{locale}/retailers` gives a retailer no
access to anything. A claim becomes useful only after a human verifies it and both sides agree in writing
what data flows. This is the preferred way to get prices (policy P1: partners first).

## 1. What arrives

`POST /v1/retailers/claims` stores a row in `retailer_claims` (company, website, contact name and email, role,
message) and e-mails the legal inbox. The form never e-mails the claimant: sending messages to arbitrary
addresses would make us a spam relay. The queue is in the admin console under **Retailer claims**.

Target: first human reply within **3 business days** (promised on the page).

## 2. Verify (never skip)

Attackers will pose as a retailer to (a) get prices removed, (b) inject fake prices, or (c) harvest contacts.

1. Find the company's **own** website and registered details (commercial registration, licence). Do not use
   the website or phone number typed in the form as the source of truth.
2. Call back on a number from that independent source, or e-mail an address on the company's own domain, and
   confirm the person named is authorised to speak for the company.
3. The contact's e-mail domain should match the company domain. Free webmail addresses need an extra check
   (for example a message sent from the company's switchboard or an official social account).
4. Mark the claim **Verifying** with a note of what you did, then **Verified** (or **Rejected**) with the
   reason. The console asks for the note; the database refuses a decision without one. Every decision is
   recorded in `audit_log` with who made it.

## 3. After verification: what can be offered

| Retailer wants | What we do | Approval needed |
|---|---|---|
| To supply an official price feed | Agree format (CSV/JSON, see `services/ingest/examples/partner-feed.csv`), cadence and contact; register the source in the Source Registry as `partner_feed`; set `approval_ref`; flip `legal_status` to green through the **four-eyes** change in the console | Second admin; signed data-supply terms (counsel template) |
| To correct wrong prices or branch data | Use the normal correction path (price report accept / source data fix), note the claim id | One admin |
| To stop us showing their data | Treat as a takedown (`docs/legal/takedown-policy.md`): kill-switch the source, answer within 2 business days | Immediate; counsel informed |
| A dashboard or promoted placement | Not available yet. Point to `docs/business/monetisation.md`; do not promise dates | Counsel and the plan's Change Log |

**Never** offer: access to shopper data, control over ranking, or payment to hide other stores.

## 4. Records

- The decision note in the console is the record. Link the claim id from the source's `approval.md` in
  `docs/legal/sources/<retailer>/`.
- Unverified and rejected claims are deleted automatically after 12 months by the maintenance job
  (`purge_retailer_claims()`); verified claims are kept as the business contact of an active partner and
  reviewed annually.
- Personal data in a claim is only the contact's name and work e-mail, used only to answer the request.
  This is row 13 in `docs/legal/ropa.md`.

## 5. Abuse handling

- The form is limited to 5 submissions per hour per client; bursts from one network are a signal.
- A claim with a message that contains instructions, links to login pages or requests to "confirm" a password
  is a phishing attempt: reject it with the reason `phishing`, do not click anything, and tell the security
  lead.
- Never reply to a claim from a personal mailbox; use the shared partnerships address so the thread is kept.
