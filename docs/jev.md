# Jev opponents

Copy `.env.example` to the repository-root `.env`, set `JEV_API_KEY` to your TypeSafe key, and restart the server. `TYPESAFE_API_KEY` is also accepted. Never use a `VITE_` variable for this key. The server entry point loads the root `.env`; existing process environment values take precedence. Requires Node 22+ for the built-in environment-file loader and SQLite.

The host can choose **Add bot** for the existing local strategist or **Add Jev** for a TypeSafe opponent. Adding Jev without a key returns a configuration error. Each Jev seat keeps its identity across restarts.

The implementation follows the [official HTTP quickstart](https://docs.typesafe.ai/introduction/quickstart) and [Choice contract](https://docs.typesafe.ai/primitives/choice): server-side POST to `https://api.typesafe.ai/v1/systemone`, model `jev-latest`, shared state and a typed Choice question. Legal action candidates cover setup, bounded sealed bids, scrapping, complete resource baskets, building and production. The local strategist's move is included. Large resource-basket spaces are capped, so this is a candidate selector rather than an exhaustive search of all possible purchases.

Context excludes player names, accounts, credentials, chat, logs, random seed, hidden deck order and rival sealed commitments. Every result must name an offered action and pass authoritative validation. Requests have a five-second default timeout and no automatic retries. Errors use the local strategist; stale responses are discarded. One-choice turns need no paid request. No live paid request is made by the automated test suite; actual provider access and play quality require a configured account.
