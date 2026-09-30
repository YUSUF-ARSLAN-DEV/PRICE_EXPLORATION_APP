# Personal-data breach response runbook (plan 0.3f, 8.5) - DRAFT

**Internal targets (stricter than we believe the law requires - counsel to confirm statutory timing):**
contain immediately; notify NCGAA within 72 h of becoming aware if serious damage is likely;
notify affected individuals without undue delay.

## Roles
| Role | Person | Backup |
| ---- | ------ | ------ |
| Incident commander | TBD | TBD |
| Tech lead | TBD | TBD |
| Privacy Lead | TBD | TBD |
| Legal/counsel | TBD | TBD |
| Comms | TBD | TBD |

## Severity
- **SEV1** personal data of users exposed/exfiltrated, or admin compromise
- **SEV2** suspected exposure, vulnerable but no evidence of access
- **SEV3** availability incident, no data impact

## Steps
1. **Detect & triage** (alert, user report, `security@`): open incident doc with timestamp.
2. **Contain:** revoke credentials/tokens, block access, disable affected feature or source, isolate.
3. **Preserve evidence:** snapshot logs/disks, do not wipe; record actions with times.
4. **Assess:** what data, how many people, risk of serious damage, is it still ongoing.
5. **Decide notification** with Privacy Lead + counsel; record reasoning even if deciding not to notify.
6. **Notify:** NCGAA via its official channel [contact TBD - verify]; affected users by email using
   template below; retailers/partners if their data involved.
7. **Eradicate & recover:** patch, rotate all secrets, restore from clean backup, verify.
8. **Post-incident review** within 5 business days: root cause, fixes, update DPIA/ROPA/threat model.

## User notice template (EN)
> We detected a security incident on [date] affecting [data types]. What happened: [...]. What we
> are doing: [...]. What you should do: [change password, beware of phishing]. Contact: [PRIVACY EMAIL].

## Tabletop exercise log
| Date | Scenario | Participants | Findings |
| ---- | -------- | ------------ | -------- |
