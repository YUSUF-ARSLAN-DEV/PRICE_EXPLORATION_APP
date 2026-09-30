# Usability test plan (plan 10.4)

**Status:** plan only. No session has been run yet; it needs real people. Automated checks (axe, Lighthouse,
Playwright) catch roughly a third of usability and accessibility problems; this plan covers the rest.

## Goals

1. Can a first-time shopper find the price of an item at several stores within one minute?
2. Is it obvious which store is cheapest, and how fresh the price is?
3. Do Arabic-first users find the Arabic UI natural (wording, RTL layout, numerals, brand names)?
4. Can a screen-reader or keyboard-only user complete the core flow?
5. Do users understand what the consent choices mean, without feeling tricked?

## Participants (target 12, minimum 8)

| Group | n | Notes |
|---|---|---|
| Arabic-first residents (Qatari + Arab expats) | 4 | at least 2 over 50 |
| English-first expats (South Asian, Filipino, Western) | 4 | weekly grocery shoppers |
| Assistive technology users (screen reader, keyboard, zoom 200 %) | 2-4 | recruit through a disability organisation; pay for their time |

Recruit through the company's own contacts and community groups, not through scraped lists (PDPPL: no
personal data is held beyond a first name and a contact channel, deleted 30 days after the study).
Every participant signs a short consent form (recording, purpose, deletion date) in their own language.
Incentive: a grocery voucher.

## Method

30-minute moderated sessions on the participant's own phone (70 % of sessions) or a laptop, thinking aloud,
facilitator in the participant's language. Screen and audio recording only with consent; the facilitator
also takes notes. Two facilitators rotate so no single person's bias dominates.

## Tasks (read aloud, in the participant's language)

1. "You need a litre of milk. Find out where it is cheapest today."
2. "Is that price up to date? How do you know?"
3. "You are buying milk, rice and eggs. Which one store is cheapest for all three? Would it be cheaper to
   split?"
4. "Switch the site to the other language."
5. "You think a price shown is wrong. Tell the site."
6. "Create an account and set an alert for when milk drops below 5 QAR." (watch the consent step)
7. "Delete everything the site knows about you."
8. Cookie banner: "What do you think happens if you choose 'only necessary'?"

## Measures

| Measure | Target |
|---|---|
| Task 1 success without help | >= 90 % |
| Time on task 1 | median < 60 s |
| Task 3 (basket) success | >= 75 % |
| Task 6 understood that the email is used for alerts only | >= 90 % |
| Task 7 completed unaided | >= 80 % |
| SEQ (single ease question, 1-7) | median >= 6 |
| SUS (System Usability Scale) | >= 80 |

## Severity and what happens next

- **S1 blocker** (task cannot be completed, or the user is misled about price/consent): fixed before beta.
- **S2 major** (completed with visible struggle): fixed before public launch.
- **S3 minor**: backlog.

Findings go to the issue tracker with a short clip or quote; any wording issue in Arabic goes to the native
reviewer (see `docs/legal/launch-checklist.md`, "Arabic review").

## Accessibility manual checklist (run in every session with an AT user and once by the team)

- [ ] NVDA + Firefox (Windows) and VoiceOver + Safari (iOS): search, product page, basket, account
- [ ] TalkBack + Chrome (Android): same flows, in Arabic
- [ ] Keyboard only: no trap, visible focus, skip link, autocomplete operable with arrow keys
- [ ] 200 % zoom and 400 % reflow (320 px): no horizontal scroll, nothing clipped
- [ ] Windows High Contrast / forced colours
- [ ] `prefers-reduced-motion` respected
- [ ] Arabic numerals and mixed-direction text (brand names in Latin script inside RTL sentences)
- [ ] Price, unit and "last updated" announced together in a sensible order

## Output

A short report (`docs/qa/usability-report-YYYY-MM.md`) with task results, SUS, top ten issues with severity,
and the list of fixes shipped. Nothing in this repository claims usability targets are met until that
report exists.
