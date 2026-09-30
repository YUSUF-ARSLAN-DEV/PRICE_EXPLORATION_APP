# Company, licence & `.qa` domain checklist (plan 0.2, ADR-004, ADR-005)

These need a human with authority; nothing here can be automated by the repo.

## Company
- [ ] Counsel chooses entity form (LLC / QFC / QFZ / QSTP) - record in a new ADR
- [ ] Trade name reserved (check MoCI availability; avoid grocer names/marks)
- [ ] Commercial registration (CR) issued -> `[CR NUMBER]`
- [ ] Trade licence with activity covering online platform / information services / advertising
- [ ] Computer card / establishment card; tax registration with the General Tax Authority
- [ ] Company bank account; company email domain/mailboxes
- [ ] Appoint **Privacy Lead** (named person) and a legal contact
- [ ] Azure billing account opened in the **company's** name (ADR-006)

## `.qa` domain (only after CR + licence)
- [ ] 2-3 candidate names checked vs trade name and trademarks
- [ ] Registrar chosen (CRA-accredited); registered as the company, company email, MFA on account
- [ ] Registrar lock + auto-renew on; WHOIS/admin contacts are role mailboxes
- [ ] Arabic IDN variant checked/reserved
- [ ] Decide DNSSEC support at the `.qa` registry (verify)
- [ ] Create mailboxes: `privacy@`, `legal@`, `support@`, `security@` (and `/.well-known/security.txt`)
- [ ] Replace `example.qa` in `.env.example`, bot User-Agent, legal docs placeholders
