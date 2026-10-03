# SWAiRM

**Build the right AI team for every task.**

SWAiRM is an AI orchestration platform. You describe a goal — a market
analysis, an ad campaign, a web app, a proof, a translation — and SWAiRM works
out which agents the task needs, proposes teams of models for those agents,
and runs the swarm with **your own** API keys.

You don't need to know which model is best for what. You say *“this is what I
want done”*; SWAiRM answers *“this is a sensible swarm for it.”*

## How it works

1. **Describe the task** in your own words (any language).
2. **SWAiRM analyses it** — areas, scope, the skills it needs.
3. **Teams are proposed** — Quality, Balanced and Budget.
4. **You pick a team** and adjust agents and models if you like.
5. **Connect missing APIs** with keys you created yourself.
6. **Start the swarm** and watch every agent's status live.
7. **Get the result** — plus the agents, models, reviews, errors, cost and runtime.

*As many agents as necessary, as few as sensible:* a simple question gets one
agent; a large project gets a Planner, specialists working in parallel, and a
Reviewer who assembles the final result.

## Run it

SWAiRM is a static web app with **no build step and no dependencies**. It runs
entirely in your browser — there is no SWAiRM server.

- **Online:** Cloudflare Pages (see *Deploy* below).
- **Locally:** serve the folder with any static server, e.g.
  `python3 -m http.server`, and open `http://localhost:8000`.
  (Opening `index.html` as a file does not work — browsers block ES modules
  from `file://`.)

To try the full workflow without any key, choose **“Use Demo for all agents”**
in the Team Builder. The Demo provider simulates answers at no cost and says
so in every answer.

## Providers

| Provider | Status | Notes |
| --- | --- | --- |
| OpenRouter | **primary** | one key for models from many vendors; also the source of the live model catalog |
| OpenAI | experimental | direct |
| Anthropic | experimental | direct |
| Google AI Studio | experimental | direct (Gemini) |
| Mistral | experimental | direct |
| xAI | experimental | direct |
| Hugging Face | experimental | Inference Providers router |
| Demo | built in | simulated, no key, no cost |

“Experimental” means the adapter follows the provider's public API, but
whether the provider accepts calls straight from a browser (CORS) is up to the
provider. If it does not, connecting shows *“Could not verify”*. New providers
are one adapter in `js/gateway/providers.js`.

**SWAiRM never creates accounts, buys access or generates keys.** You create a
key at the provider and paste it in *API Connections*.

## Your keys

- A key stays in your browser and is sent only to its own provider.
- It is never shown again after connecting — the UI shows only
  🟢 Connected / 🔴 Not connected / ⚠️ Invalid.
- It never appears in logs or error messages (errors are redacted), and it is
  never passed to agents: agents talk to the Model Gateway, and only the
  gateway reads the key.
- By default a key is **forgotten when you close the tab**. “Remember on this
  device” is an explicit opt-in.
- A strict Content Security Policy allows scripts only from this site and
  network calls only to the supported providers.

There is no tracking and no analytics. Teams, projects and history stay in
your browser.

## Architecture

```
index.html ─ js/app.js            shell, routing, shared context
             js/views/            Dashboard, New Task, Model Advisor, Team Builder,
                                  Run, Result, History, Projects, Teams, Agents,
                                  Models, API Connections, Settings
             js/core/
               roles.js           agent roles (Planner, Researcher, Coder, …) — not tied to models
               analyze.js         task → areas → scope → needed roles (local, transparent heuristic)
               catalog.js         live model catalog + model selection per role and tier
               advisor.js         roles + models → Quality / Balanced / Budget teams, estimates
               workflow.js        dependency graph: who waits for whom, what runs in parallel
               orchestrator.js    runs the graph, passes results between agents
             js/gateway/
               gateway.js         Model Gateway — the only path from agents to providers
               providers.js       provider adapters behind one interface
               vault.js           the only place keys live
```

The task analysis runs locally and shows which words triggered each area, so
the advisor works before any key is connected. Model choice uses the live
OpenRouter price list as a rough proxy for capability plus a per-role vendor
preference — a starting point, not a benchmark. All costs before a run are
labelled as estimates; after a run SWAiRM shows the cost the provider reported.

## Tests

```
node --test tests/*.test.mjs
```

No dependencies. The tests cover analysis, team composition, model selection,
the workflow graph, and a full swarm against a fake OpenRouter — including
that keys never reach a request body, a run record or an error message.

## Deploy (Cloudflare Pages)

Set up once in the Cloudflare dashboard:

1. **Workers & Pages → Create application → Pages → Import an existing Git
   repository**, choose `SWAiRM`, **Begin setup**.
2. Project name `swairm` (becomes `swairm.pages.dev`), production branch `main`.
3. Framework preset **None**, build command `sh build.sh`, build output
   directory `dist`.
4. **Save and Deploy**.

After that every merge to `main` deploys automatically, and every pull request
gets its own preview address. `build.sh` runs the tests first — a failing test
stops the deploy and the previous version stays online. Security headers
(CSP, no framing, no referrer) come from `_headers`.

## License

[GNU AGPL-3.0](LICENSE).
