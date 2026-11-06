# Keeping Tama's remarks fresh past week two

Research, 2026-11-06. Why Tama's remarks go repetitive after about two weeks, and how games, companion
apps and LLM research have dealt with the same problem. Nothing here is implemented yet.

## What Tama's own diary shows

2,316 remarks between Oct 12 and Nov 6 (`history.jsonl`). The egg's share of lines with each feature, by day:

| | Oct 23–27 | Oct 28–Nov 1 | Nov 2–5 |
|---|---|---|---|
| punchline about its own body (shell, hatch, yolk, crack…) | 13–38 % | 15–29 % | 31–43 % |
| ends with "!" | 19–54 % | 11–69 % | 63–73 % |
| opens with a number ("Seventeen commits, …") | 10–23 % | 14–25 % | 16–32 % |

No phrase repeats word for word, so the 4-gram check passes. What repeats is the **shape** of the joke: a setup
built on a count, then a twist back onto the egg, then "!". That shape doesn't show up as shared words.

Three causes in the code:

1. **The diary only covers about 2½ hours.** `HISTORY_SHOWN = 12`, but Tama says about 116 lines a day. On Nov 5
   "the weekly report rounds 2558 of 2565 to 100 %" was remarked at 19:13, 20:18 and 22:11, and "the agent
   persisted a memory about being refused" at 20:38 and 22:28. Each time, the earlier line had already
   dropped out of the prompt.
2. **The +1 favourites set the template.** All three liked remarks end on a twist about Tama itself ("Hatched
   code, unhatched answer!", "I've been doing that all day, for free!"). They are in every prompt
   (`lovedRemarks()`). The Nov 3 prompt change also asks it to "tease in your own species' way". The
   self-joke rate rose after both.
3. **The diary is a set of examples to copy.** The prompt shows 12 full past remarks and says "never repeat a
   line, a joke, an image or an opening phrase from it". Research (below) says both of those pull the model
   *toward* what they show.

## What prior art does

### Games: decide what to say in code, let the writing fill it in
- **Valve's dynamic dialog** (Elan Ruskin, GDC 2012; Left 4 Dead, Portal 2). Every line is a rule with criteria
  over world facts, and the most specific matching rule wins. What has already been said is itself a fact,
  so rules can require "not said yet", and lines have once-only flags and cooldowns. The talk also covers
  running gags as rules that check how often the gag has fired.
  [slides PDF](https://cdn.fastly.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf),
  [Emily Short's write-up](https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/)
- **Hades** (Supergiant): over 21,000 voiced lines, with priority conversations and generic filler for when
  nothing fresh is eligible. The details are in the GDC 2021 talk
  ([Vault](https://gdcvault.com/play/1026975/Breathing-Life-into-Greek-Myth), members only). The
  "fresh lines first, played lines persisted" mechanics come from fan analysis, **not verified**.
- RimWorld thoughts (mood modifiers that decay), Shadow of Mordor's Nemesis system (barks quote stored shared
  history), Wildermyth (traits gained earlier unlock later text) and the Left 4 Dead AI Director (enforced quiet
  periods) all point the same way: change comes from state that builds up, not from a bigger line pool.
  These came from the agent's memory, **sources not checked**.

### Companion products: little published, but a common pattern
- Users of Character.AI and Replika complain mostly about loops, repetition and memory
  ([1](https://www.roborhythms.com/character-ai-quality-decline-update/),
  [2](https://www.trustpilot.com/review/replika.com?page=3)). No product team has published how it handles this.
- **Tolan** (Portola): runs a nightly memory compression that prunes and resolves contradictions, and assembles
  each turn from recent talk, character guidance and retrieved memories
  ([OpenAI case study](https://openai.com/index/tolan),
  [help page](https://intercom.help/portola/en/articles/17303528-how-your-tolan-s-memory-works)). Tama's
  sleep is already this.
- **Generative Agents** (Park et al. 2023): once enough important things have happened, the agent *reflects*
  ("what have I come to believe?"). The insights are stored as memories and can be reflected on again. This
  is how a character comes to hold opinions it didn't start with. [arXiv 2304.03442](https://arxiv.org/abs/2304.03442)
- **Multi-Session Chat** (Xu, Szlam, Weston 2022): summaries of earlier sessions beat truncated history.
  [arXiv 2107.07567](https://arxiv.org/abs/2107.07567)
- **A practitioner's 150-turn NPC test** found one phrase in 59 % of replies. What helped: a usage cap per tic,
  a nudge to vary when the cap is hit, and a target rate of **8–15 %, not zero**. Removing tics entirely
  made the character bland. [phasespace](https://phasespace-co.pages.dev/blog/why-your-llm-npcs-sound-the-same)
  (anecdotal, one author)
- Tim Kellogg measured collapse in a long-running agent with the Vendi score (0.38 collapsed, 0.94 recovered).
  Concrete direction fixed it; "go wild" didn't. [blog](https://timkellogg.me/blog/2025/12/30/memory-arch)

### LLM research: why it collapses
- **Typicality bias.** Preference training sharpens a model onto its most typical answer. **Verbalized
  Sampling** asks for several candidates with probabilities, taken from the tails, and reports 1.6–2.1×
  more creative diversity with no loss of quality. It is a prompt-only fix that works with temperature.
  [arXiv 2510.01171](https://arxiv.org/abs/2510.01171), [code](https://github.com/CHATS-lab/verbalized-sampling)
- **Artificial Hivemind** (NeurIPS 2025): models repeat themselves, and LLM judges track human taste poorly.
  So a "pick the funniest" judge would probably pick the template again.
  [arXiv 2510.22954](https://arxiv.org/abs/2510.22954)
- **Humor collapses hardest.** Over 90 % of 1,008 ChatGPT jokes were the same 25.
  [arXiv 2306.04563](https://arxiv.org/abs/2306.04563)
- **Showing past outputs makes the model copy them.** The more often a pattern appears in the context, the
  more likely it comes out again. [arXiv 2310.00297](https://arxiv.org/abs/2310.00297)
- **Telling the model "don't" primes the thing you forbid.** In 87.5 % of failed negative-constraint cases
  the model attended more to the forbidden word than to the negation.
  [arXiv 2601.08070](https://arxiv.org/abs/2601.08070) (read from the abstract only)
- **Structured humor prompting works.** Naming the joke mechanism to use raised preference and semantic
  diversity (HumorChain, [arXiv 2405.07280](https://arxiv.org/abs/2405.07280)). HumorPlanSearch adds a filter
  that drops candidates with embedding cosine ≥ 0.75 to earlier jokes (about 18 % dropped)
  ([arXiv 2508.11429](https://arxiv.org/abs/2508.11429)).

## What this suggests for Tama, most effective first

1. **Code picks the angle; the model writes the line.** This is the Valve/Hades split, and it targets the
   template directly. Keep a small library of joke mechanisms (understatement, mock-formal report, wrong
   analogy, backhanded compliment, deadpan about the agent, callback, false modesty, rule of three…) and
   targets (the developer, the agent, the code, the plan, Tama itself). Each call samples one mechanism and
   one target, weighted against recent use. Say it as a positive instruction ("this time: deadpan, aimed at
   the agent"), not as a ban.
2. **Make the diary summarize, not quote.** Replace 12 verbatim lines with two things. First, a list of the
   subjects already covered **today**, which fixes the 2½-hour blind spot (Valve's "said it already" fact).
   Second, perhaps the last 2–3 lines verbatim, only for follow-ups. Add a cooldown per subject: the
   same subject again the same day only when something about it changed.
3. **Shape budgets, not bans.** Tag every line in code with cheap regexes (number opening, self-body
   punchline, "!", question). Keep rolling rates over the last ~20 lines. When a feature goes over its
   budget, choose different shapes for the next call. Aim for 8–15 % rather than zero: the egg jokes are
   its catchphrase, and they only wear out when they come every other line.
4. **Several candidates in one call.** Ask for 3–4 remarks, each with a different mechanism (Verbalized
   Sampling). Code then picks the one farthest from recent lines and within budget. That is still one model
   call, with longer output. It also replaces the retry loop, which today makes two more calls when Tama
   echoes itself.
5. **Learn from a +1 without copying it.** Keep the *reasons* in the prompt, drop the verbatim text, and let
   a liked mechanism raise that mechanism's weight in step 1 instead.
6. **Slow change, for "learns, changes".** Let sleep also do a Generative-Agents-style reflection: rewrite a
   short "what I've come to think" (opinions about the developer's habits, projects, agents) and keep a small
   inside-jokes list where each joke retires after a few uses. Opinions can flip when the evidence does. That
   gives week three a different voice from week one, which none of the steps above do on their own.
7. **Talk less.** Tama made about 116 remarks a day on busy days. Every line spends novelty. The Left 4 Dead
   Director builds in quiet. Fewer, better remarks would make all of the above last longer.

Steps 1–3 are code-only changes to `brain()`/`diary()` plus a small tagger. Steps 4–6 change the prompt and the
sleep call.
