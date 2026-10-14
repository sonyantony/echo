# ECHO — Workflow Development Setup: Front-End Plan

> Build plan for Claude Code. Put this file in the repo (for example `docs/ECHO-frontend-plan.md`) and work through it **one phase at a time**.

## 1. Goal

Build the **Workflow Development Setup** screen for ECHO (EY Cognitive Hub for Orchestration). This is the screen a Subject Matter Expert (SME) uses to start a new workflow. It does three things:

1. Picks **one** workflow source:
   - (a) a Jira user story,
   - (b) an uploaded workflow file, or
   - (c) a section of a user story document.
2. Picks the **client APIs** (TMF APIs) the workflow may call.
3. Submits that setup to the Java backend, which starts the workflow-generation process.

The reference design is the "ECHO Workflow Development Setup" mockup in Claude Design.

**Out of scope:** the drag-and-drop orchestration designer, the runtime (Camel / Node-RED), and anything that happens after submission.

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript (strict)** | The ECHO stack is Next.js plus Java |
| Styling | **Tailwind CSS** | Fast and consistent; design tokens live in one place |
| UI primitives | **shadcn/ui (Radix)**: RadioGroup, Popover, Command (combobox), Checkbox, Button, Input | Accessible keyboard and screen-reader behavior out of the box |
| Forms | **React Hook Form + Zod** | A discriminated-union schema fits "one active source" |
| Server data | **TanStack Query** | Caching, loading and error states, dependent queries (project → stories) |
| API mocking | **MSW (Mock Service Worker)** | Build the whole UI before the Java API exists |
| API types | **openapi-typescript**, generated from the Java service's OpenAPI/Swagger spec | One contract, no hand-written drift |
| Unit/component tests | **Vitest + Testing Library** | |
| E2E tests | **Playwright** | |
| Lint/format | ESLint + Prettier | |

**Backend access rule:** the browser never calls Jira or TMF systems directly. All calls go to the Java backend through a Next.js route proxy at `/api/*`, which keeps tokens and session cookies on the server.

## 3. Screen behavior (the spec)

### 3.1 Layout
- **App header:** "EY ECHO" wordmark, the section name "Workflow Development", and the user's initials avatar.
- **Page:** the title "ECHO Workflow Development" with the subtitle "Subject Matter Expert view".
- **Card:** contains section 1 (Workflow source) and section 2 (Client APIs to Use), separated by a divider.
- **Action:** a primary **Continue** button at the bottom of the card. The mockup doesn't show a submit button, so confirm this with the business.
- **Responsive:** the layout works down to 375 px wide. Side-by-side dropdowns stack on narrow screens.

### 3.2 Section 1: Workflow source (radio group, stacked vertically)

| # | Option label | Sub-fields when active |
|---|---|---|
| 1 | Retrieve the Workflow from a Jira User Story | **Select Jira Project Name** (combobox), then **Select User Story** (searchable combobox) |
| 2 | Upload Workflow from a File | **Upload File** button (file picker, plus drag-and-drop if cheap) |
| 3 | Retrieve the Workflow from a User Story Document | **User Story Section** (text input) + **Upload File** button |

Rules:
- Exactly one option is active. Option 1 is the default.
- **Inactive options keep their sub-fields visible but disabled.** They are greyed out, cannot be focused, and are not validated.
- Values typed into an inactive option are **kept** if the user switches back. Only the active option's values are validated and submitted.
- **Jira dependency:** the User Story combobox is disabled until a project is chosen. Changing the project clears the selected story.
- **User Story combobox:** searches on the server (debounced 300 ms), shows the story key (e.g. `EDPPV-1234`) plus its summary, and is scrollable.
- **Uploads:** check type and size on the client before uploading, show the file name and size after picking, and allow remove or replace.
  - Accepted types and the size limit are still to be confirmed (see section 9). Until then use `.yaml,.yml,.json,.xml` for workflow files and `.docx,.pdf,.md` for documents, with a 10 MB limit.

### 3.3 Section 2: Client APIs to Use (multi-select)
- A combobox with checkboxes. The trigger shows selected APIs as **removable chips**, for example `TMF 639 ×`.
- The list is scrollable and searchable, and loads from the backend.
- At least one API is required. This is an assumption; confirm it.

### 3.4 Validation and states
- Validation errors appear inline under the field, after the first submit attempt or when the field loses focus.
- Every remote list has **loading**, **empty** and **error with retry** states.
- On submit: the button shows a spinner and the form is locked.
  - On success: navigate to the next step. Use `/workflows/{id}` as a placeholder.
  - On failure: show an error banner and keep the user's input.

### 3.5 Accessibility (must-haves)
- Radio buttons, comboboxes and checkboxes are real, labelled controls, fully usable by keyboard.
- Disabled sub-fields use the `disabled` attribute, not just styling.
- Chips have an `aria-label` such as "Remove TMF 639".
- Text contrast is at least 4.5:1, including greyed-out labels, which must stay readable.

## 4. Data model

```ts
// lib/workflow-setup/schema.ts
const jiraSource = z.object({
  type: z.literal("jira"),
  projectKey: z.string().min(1, "Select a Jira project"),
  storyKey: z.string().min(1, "Select a user story"),
});
const fileSource = z.object({
  type: z.literal("file"),
  fileId: z.string().min(1, "Upload a workflow file"), // id returned by the upload endpoint
});
const documentSource = z.object({
  type: z.literal("document"),
  section: z.string().trim().min(1, "Enter the user story section"),
  fileId: z.string().min(1, "Upload the user story document"),
});

export const workflowSetupSchema = z.object({
  source: z.discriminatedUnion("type", [jiraSource, fileSource, documentSource]),
  clientApiIds: z.array(z.string()).min(1, "Select at least one client API"),
});
export type WorkflowSetup = z.infer<typeof workflowSetupSchema>;
```

Keep per-option draft values in form state, so switching options doesn't lose input. Build the `source` object from the active option at submit time.

## 5. Backend contract (proposed; agree it with the Java team)

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/api/jira/projects` | Projects visible to the user | `[{ key, name }]` |
| GET | `/api/jira/projects/{key}/stories?q=&page=` | Search stories in a project | `{ items: [{ key, summary }], nextPage }` |
| POST | `/api/uploads` (multipart: `file`, `kind=workflow\|document`) | Upload a file | `{ fileId, name, size }` |
| GET | `/api/client-apis` | Selectable TMF APIs | `[{ id, label, description? }]` |
| POST | `/api/workflows/setup` | Submit the `WorkflowSetup` | `{ workflowId }` |

Errors use one shape everywhere, for example RFC 7807 `{ title, detail, status }`.

Once the Java service publishes OpenAPI, run `openapi-typescript` and replace the hand-written types (phase 8).

## 6. Proposed structure

```
app/
  (echo)/layout.tsx                      # header shell
  (echo)/workflows/new/page.tsx          # this screen
  api/[...path]/route.ts                 # proxy to Java backend (phase 8)
components/
  layout/AppHeader.tsx
  workflow-setup/
    WorkflowSetupForm.tsx                # form root, RHF provider, submit
    SourceOptionJira.tsx
    SourceOptionFile.tsx
    SourceOptionDocument.tsx
    ClientApiMultiSelect.tsx
    FileUploadField.tsx                  # shared by options 2 and 3
  ui/                                    # shadcn components
lib/
  api/client.ts                          # fetch wrapper + error shape
  api/hooks.ts                           # TanStack Query hooks
  api/types.ts                           # hand-written now, generated later
  workflow-setup/schema.ts
mocks/
  handlers.ts                            # MSW handlers + fixture data
  fixtures.ts                            # Voltron/3Flow/PRO, EDPPV-*, TMF 639/631/638
tests/
  e2e/workflow-setup.spec.ts
```

## 7. Phases

Each phase is one Claude Code session and one commit (or one PR). Don't start the next phase until the current one's checks pass.

### Phase 0: Scaffold
- Create the Next.js app (TypeScript strict, App Router, ESLint), then add Tailwind, shadcn/ui, Vitest + Testing Library, Playwright and MSW.
- Add npm scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`.
- Write `CLAUDE.md` (see section 8).
- **Done when:** `npm run lint && npm run typecheck && npm test && npm run build` all pass on an empty page.

### Phase 1: Layout shell
- Build the header, the page title and subtitle, and the empty card at `/workflows/new`.
- Put design tokens (colors, radius, spacing) in the Tailwind config, matching the mockup.
- **Done when:** the page matches the mockup's shell at desktop and 375 px widths.

### Phase 2: Form model and source radio group (static data)
- Add the Zod schema, the React Hook Form setup, the three options, and the enable/disable logic.
- Use hard-coded options here; phase 3 swaps them for API data.
- **Done when** unit tests prove that:
  - only the active option is enabled,
  - switching options keeps draft values,
  - changing the project clears the story,
  - validation messages match section 4.

### Phase 3: API layer and mocks
- Add the `lib/api` client, the TanStack Query hooks, MSW handlers and fixtures for every endpoint in section 5, including slow, empty and error variants.
- **Done when:** the app runs fully against MSW in dev, and an env flag switches mocks on and off.

### Phase 4: Jira section
- Wire the project combobox to `GET /projects`, and the story combobox to debounced server search with paging.
- Add loading, empty and error-with-retry states.
- **Done when** component tests cover:
  - search is debounced,
  - stories are disabled until a project is picked,
  - an error shows a retry,
  - the controls are keyboard-operable.

### Phase 5: Upload sections (options 2 and 3)
- Build `FileUploadField`: picker, client-side type and size checks, upload progress, and remove or replace.
- Add the User Story Section input to option 3.
- **Done when** tests cover:
  - a wrong type or too-large file is rejected with a message,
  - a successful upload stores `fileId`,
  - disabled when inactive.

### Phase 6: Client APIs multi-select
- Build a combobox with checkboxes, search, removable chips and the min-1 validation.
- **Done when** tests cover:
  - checking an API adds a chip,
  - removing a chip unchecks the API,
  - the validation message appears.

### Phase 7: Submit flow
- Build the payload from the active source, POST it, then handle success (navigate) and failure (banner, input kept).
- **Done when:** a Playwright e2e test covers each of the three source paths end to end against MSW, plus one server-error case.

### Phase 8: Connect to the real Java backend
- Add the `/api/[...path]` proxy route, with the backend URL set by environment variable.
- Generate types from the Java OpenAPI spec and delete the hand-written ones.
- Turn mocks off by default outside dev.
- **Done when:** the e2e suite passes against a running backend (or its staging URL).

### Phase 9: Accessibility and polish
- Run an axe check in Playwright, a keyboard-only walkthrough, contrast checks, and a narrow-screen pass.
- **Done when:** axe reports no serious or critical violations, and the screen matches the mockup.

## 8. `CLAUDE.md` starter (create in phase 0)

```markdown
# ECHO front end

- Stack: Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, React Hook Form + Zod, TanStack Query, MSW, Vitest, Playwright.
- Plan: docs/ECHO-frontend-plan.md. Work one phase at a time; don't start the next phase unasked.
- Before saying a task is done, run: npm run lint && npm run typecheck && npm test (and npm run test:e2e when UI flows change).
- The browser never calls Jira or TMF systems directly; everything goes through /api/* (the Java backend).
- Use shadcn/ui primitives for controls; no custom div-based buttons or checkboxes.
- Keep fixtures in mocks/fixtures.ts; don't put sample data inside components.
- Types for API payloads live in lib/api/types.ts (generated from OpenAPI once available).
```

## 9. Open questions (answer these before or during the phases they affect)

1. **Auth:** how does the SME sign in (EY SSO / Entra ID?), and does the Next.js server or the Java service own the session?
2. **Jira:** does the backend use one service account, or the SME's own Jira permissions? This decides which projects each SME sees.
3. **Workflow file format (option 2):** Camel YAML DSL, Node-RED flow JSON, BPMN or something else? Also the max size.
4. **User story document (option 3):** which formats (.docx, .pdf, Confluence export?), and what is a "section": a heading name, a page range, or free text?
5. **Client APIs:** is the list fixed, or does it depend on the Jira project? Is at least one API required?
6. **After Continue:** what's the next screen, and should a draft be saved so the SME can come back later?
7. **Branding:** is there an EY design system or component library the UI must use instead of shadcn defaults?

## 10. How to run this with Claude Code

1. Create the repo, add this file as `docs/ECHO-frontend-plan.md`, and start Claude Code in the repo folder.
2. For each phase, start in **plan mode** (Shift+Tab) and ask:
   > Read docs/ECHO-frontend-plan.md. Plan Phase N only: list the files you'll create or change and the tests you'll add. Don't write code yet.
3. Review the plan, then approve it and let Claude Code implement it.
4. Ask it to run the "Done when" checks, then review the diff and commit:
   > Run the Phase N checks and fix anything failing. Then summarize what changed.
5. Use `/clear` between phases so each one starts with a clean context. The plan file and `CLAUDE.md` carry everything forward.
