# Toll booths, outbound, and the conversation guide

## Toll booths — the one obvious place(s)

Where do people in the primary bet's situation reliably show up?

1. **Owners of public skills repos.** The competitive scan already built
   the target list
   ([`target-repos-brownfield.md`](../../research/2026-07-11-competitive-scan/target-repos-brownfield.md)):
   mattpocock/skills, gstack, EveryInc/compound-engineering-plugin, and
   every repo like them (searchable: repos with 5+ `SKILL.md` files).
   These people are simultaneously ICP (their skills are load-bearing for
   their users), reachable (public GitHub, public socials), and the
   word-of-mouth engine if it works.
2. **Model-release moments.** Every model launch produces threads of
   "did X break your setup?" That's not a channel, it's a **clock**: the
   week after a release is when vector 1's project is live in the most
   heads at once. Pre-draft the receipts drops so they land that week.
3. **The plugin/marketplace ecosystem discussions** (Claude Code and
   Codex GitHub discussions, skills-adjacent Discords) — where "how do
   we share/trust skills" is asked by people who mean it.

## The signature play: the receipts drop

The product does the outbound's work. For a target with a public skills
repo, before writing to them:

```
git clone <their repo> && skillmaker adopt
# add 1–2 fixtures for their most load-bearing skill, run on both providers
```

Then send them **their own receipts**. The message is weird in Snyder's
sense — impossible to pattern-match to sales spam, and answering it costs
them nothing because the work is already done:

> Hey — I ran your skills repo through a tool I'm building. All 39
> adopted clean, and I measured `<their-skill>` on claude-code vs codex:
> they disagree. Want the numbers?

Rules: the numbers must be real (never send a receipts drop we didn't
run), the caveats travel with them (n, CI, "below smoke"), and if their
repo surfaces a bug in adopt, that bug report *is* the outreach.

## Other message drafts (calibrate weirdness, keep honesty)

- **Model-release week:** "Did <model> break any of your skills? Mine,
  yes — two of them, silently. I built a thing that answers that with a
  pass rate instead of a vibe. Send me your worst skill and I'll send
  back its measurement."
- **The builder's confession (design-partner recruit):** "I'm building a
  factory for agent skills because mine kept rotting silently. Pre-alpha,
  free, runs local, phones nothing home. Looking for 3 people whose
  skills are load-bearing to break it with me — I do the work on your
  repo, you keep the receipts."
- **To the hand-rolled-CI teams (gstack-shaped):** "You built scheduled
  evals and golden-file tests for your skills — you're one of maybe a
  dozen teams on earth who bothered. I'm building that as a product and
  your setup is the existence proof. Can I show you where mine is worse
  than yours?"

What we never send: the HubSpot Standard, the sales haiku, "who's the
right person at your org," or any message a template could have written.

## The conversation guide

Goal: find pull or disqualify fast. We are testing the PULL claim, not
pitching the pillars.

**Open on their world, not our product:**
- "What happened in the last month that made you look at this at all?"
- "Walk me through the last time a skill broke or surprised you.
  What did you do that afternoon?"
- "When <model> shipped, what did you actually do about your skills —
  concretely, that week?"
- "What are you doing today when you need to trust a skill someone else
  wrote?"

**Test unavoidability (the priest test — who doesn't need convincing):**
- "If this tool didn't exist, what would you do instead?" (If the honest
  answer is "nothing, it's fine" — no demand. Log it, thank them, move
  on. Do not educate.)
- "Would it be OK if I didn't build this?"

**Offer the Stripe link:**
- "It's one curl. Run `skillmaker adopt` on your repo right now — takes
  under a minute, moves nothing." Then watch. Leaning in, screen-sharing,
  asking "can it do X on my repo" = pull. "Send me a deck" = no pull.

**Never do:** convince, discount the caveats, promise roadmap to close,
or count a polite "cool, I'll check it out" as anything.

## Instrumentation: the contrast log

No telemetry means conversations are the dataset. Keep one append-only
log (a Skillmaker todo list or a flat file — dogfood either way), one
entry per conversation:

- who (person + situation, not segment), where we found them
- their words for the project, verbatim
- what they were doing about it before us
- outcome on the ladder: installed on call / adopted own repo / ran +
  graded / returned unprompted / went quiet
- if they didn't pull: our best guess why, in their words

Monthly: contrast the fast-pulls against the didn't-pulls and rewrite
[`pull-bets.md`](pull-bets.md) from the contrast. The ICP chooses the
startup; this log is how we find out who chose us.
