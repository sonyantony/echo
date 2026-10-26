# 0016. Import From Jira reads stories with a shared read-only account and finds examples without AI first

Date: 2026-10-26
Status: Accepted

Teams write the payloads an API takes and returns into the Jira story that asks for it, often with
a corrected version in a later comment. Interface's **Import From Jira** makes the spec's paths and
data types from them (docs/api-spec.md), so nobody types them in again.

- **One shared, read-only Jira account per install**, in `echo.jira` (the user chose this over each
  user signing in with their own Jira account, and over OAuth, which needs every buyer to register
  an app). Cloud uses email + API token (Basic, REST API 3), Data Center a personal access token
  (Bearer, REST API 2). The token lives in the local config or `.env`, never in Git. Only links on
  `base-url` are read, so a pasted link cannot send the token elsewhere. Plain HTTP on the JDK client,
  like S3: no Atlassian SDK.
- **Examples are found without AI, and the user always checks them.** `ExampleFinder` takes every
  JSON object (or array of objects) in code blocks and text, every `METHOD /path` or URL, and query
  parameter lines, and guesses which example is which from the call written before it and the word
  ("request", "response") just before it, picking the newest when there are several. The guess is
  only a starting point: a dialog shows every operation with its examples as choices, and nothing is
  added until the user confirms. This works on any install, with no AI engine configured.
- **AI comes next, behind an interface.** An AI step will label the same examples (it picks among
  what the story has; payloads are never written by the AI, and every answer is checked to parse and
  to be in the story). It sits behind one Java interface so engines can be added as one class; the
  first speaks the OpenAI protocol with a configurable endpoint, key and model, which covers OpenAI,
  Azure OpenAI (most of Azure AI Foundry), Ollama, vLLM and gateways. We looked at GitHub Copilot:
  it has no API a server can send a prompt to (its Copilot SDK runs an agent per signed-in user), and
  Microsoft 365 Copilot's Chat API is a Graph beta for signed-in users only, so neither is first.
- **Imports add to the spec**, unlike New From Samples, which replaces it: a story is usually one or
  two operations of a bigger API. An operation the spec has is replaced only when the user keeps it
  ticked, and keeps its operationId so its route stays connected.
