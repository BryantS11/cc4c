
# 🧠 Automation Rules JSON Format

This document explains the JSON schema and available options for defining **automation rules** executed by the `automation-runner.js` engine.

The runner allows declarative browser automation (via Puppeteer) without hard-coding site logic — each site's behavior is defined in a JSON file that can be hosted remotely (e.g. a GitHub raw link) and auto-refreshed on a configurable timer.

---

## 📦 Top-Level JSON Structure

A valid automation configuration has two top-level keys:

```json
{
  "macros": [ ... ],
  "rules": [ ... ]
}
```

| Key      | Type    | Required | Description                                           |
| -------- | ------- | -------- | ----------------------------------------------------- |
| `macros` | `array` | No       | Reusable named step sequences callable from any rule  |
| `rules`  | `array` | Yes      | Per-site automation rules matched against the page URL |

> [!NOTE]
> If the JSON is a plain array (no wrapper object), it is treated as the `rules` array directly.

---

## 🌍 `rules[]` — Site Automations

Each entry in the `rules` array matches a website and defines what steps to run.

### Rule Fields

| Field   | Type     | Required | Description                                                                     |
| ------- | -------- | -------- | ------------------------------------------------------------------------------- |
| `site`  | `string` | Yes      | Hostname or pattern to match (see [URL Matching](#-url-matching-rules) below)   |
| `steps` | `array`  | Yes      | Ordered sequence of steps to execute when the rule matches                      |

### Minimal Rule Example

```json
{
  "rules": [
    {
      "site": "example.com",
      "steps": [
        { "action": "delay", "args": [3000] },
        { "action": "evaluate", "args": ["document.querySelector('.overlay')?.remove()"] }
      ]
    }
  ]
}
```

---

## 🧭 URL Matching Rules

When a stream request comes in with `?url=...`, the runner extracts the hostname (strips `www.`), then checks each rule's `site` field in order. **The first matching rule wins.**

### Match Types

| Pattern Type     | Syntax                     | Example `site` Value         | Matches                                          |
| ---------------- | -------------------------- | ---------------------------- | ------------------------------------------------ |
| **Plain hostname** | Bare domain              | `"nbc.com"`                  | `nbc.com`, `www.nbc.com`, `live.nbc.com`         |
| **Wildcard**       | `*.domain.com`           | `"*.sling.com"`              | `watch.sling.com`, `beta.sling.com`, `sling.com` |
| **Regex**          | `/regex/` (slashes wrap) | `"/^watch\\..*\\.net$/"`     | `watch.spectrum.net`, `watch.example.net`         |

### Detailed Matching Behavior

- **Plain hostname**: The `www.` prefix is stripped from both the `site` value and the incoming URL. A match occurs if the incoming hostname exactly equals or ends with `.{site}`. For example, `"nbc.com"` matches `nbc.com`, `www.nbc.com`, `live.nbc.com`, and `stream.live.nbc.com`.

- **Wildcard** (`*.`): The `*.` prefix is removed, then matched the same way as plain — the incoming hostname must equal the base domain or end with `.{domain}`. So `"*.sling.com"` matches `sling.com`, `watch.sling.com`, etc.

- **Regex**: The `site` value must start and end with `/`. The inner string is compiled as a case-insensitive regex (`/i` flag) and tested against the stripped hostname. For example, `"/^(watch|stream)\\.example\\.com$/"` would match `watch.example.com` and `stream.example.com`.

### Example — Multiple Matching Strategies

```json
{
  "rules": [
    { "site": "nbc.com", "steps": [ ... ] },
    { "site": "*.sling.com", "steps": [ ... ] },
    { "site": "/^watch\\..*\\.net$/", "steps": [ ... ] }
  ]
}
```

---

## ⚙️ Supported Actions

Each step can have an `action` field with an `args` array. The table below lists **every action** the runner supports — use these exact names.

| Action              | Args                                          | Description                                  |
| ------------------- | --------------------------------------------- | -------------------------------------------- |
| `goto`              | `[url]`                                       | Navigate to a URL (`waitUntil: domcontentloaded`) |
| `waitForSelector`   | `[cssSelector]`                               | Wait up to 15 s for a CSS selector to appear |
| `waitForFunction`   | `[jsExpression, timeoutMs?]`                  | Wait for a JS expression to return truthy    |
| `conditional`       | `[jsExpression]`                              | Evaluate JS in page; logs if result is falsy |
| `mouseClick`        | `[x, y, options?]`                            | Click at pixel coordinates on the page       |
| `keyboardType`      | `[text]`                                      | Type a string character-by-character         |
| `keyboardPress`     | `[key]`                                       | Press a single key (e.g. `"Enter"`, `"Tab"`) |
| `evaluate`          | `[jsCode]`                                    | Execute arbitrary JavaScript in page context |
| `screenshot`        | `[filePath?]`                                 | Save a screenshot (default: `screenshot.png`)|
| `delay`             | `[ms]`                                        | Pause execution for milliseconds (default: 1000) |
| `loop`              | `[count]` + `"steps": [...]`                  | Repeat nested steps `count` times            |

> [!CAUTION]
> The action names are **case-sensitive** and must match exactly. Common mistakes:
> - Use `mouseClick` not `click`
> - Use `keyboardType` not `type`
> - Use `keyboardPress` not `press`
> - Use `delay` not `wait`
> - Use `evaluate` not `eval`

### Action Details & Examples

#### `goto` — Navigate to a URL

Navigates to the given URL. Waits until the DOM content is loaded before continuing.

```json
{ "action": "goto", "args": ["https://example.com/live?channel=abc"] }
```

With template expression:

```json
{ "action": "goto", "args": ["https://example.com/watch?ch={{query.ch}}"] }
```

---

#### `waitForSelector` — Wait for a CSS Element

Waits up to **15 seconds** for a DOM element matching the CSS selector to appear.

```json
{ "action": "waitForSelector", "args": ["video"] }
```

```json
{ "action": "waitForSelector", "args": ["div.player-container iframe"] }
```

---

#### `waitForFunction` — Wait for a JS Condition

Waits until a JavaScript expression evaluated in the **page context** returns a truthy value. The optional second argument sets a custom timeout in milliseconds (default: 15000).

```json
{ "action": "waitForFunction", "args": ["document.querySelector('video')?.readyState === 4"] }
```

With a custom timeout of 30 seconds:

```json
{ "action": "waitForFunction", "args": ["document.querySelector('video')?.readyState >= 3", "30000"] }
```

---

#### `conditional` — Check a Page Condition

Evaluates a JavaScript expression in the page context. If the result is falsy, a log message is printed — but execution **continues** (it does not skip subsequent steps).

```json
{ "action": "conditional", "args": ["document.querySelector('.live-badge') !== null"] }
```

---

#### `mouseClick` — Click at Coordinates

Clicks at specific `(x, y)` pixel coordinates on the page. An optional third argument can provide Puppeteer click options (e.g. `{ "button": "right" }`).

```json
{ "action": "mouseClick", "args": [960, 540] }
```

Click in the center of a 1920×1080 viewport:

```json
{ "action": "mouseClick", "args": [960, 540, { "button": "left", "clickCount": 1 }] }
```

---

#### `keyboardType` — Type Text

Types a string of text character-by-character, simulating real keyboard input with natural delays.

```json
{ "action": "keyboardType", "args": ["my search query"] }
```

With a dynamic value from the URL query string:

```json
{ "action": "keyboardType", "args": ["{{query.channel}}"] }
```

---

#### `keyboardPress` — Press a Single Key

Presses a single keyboard key. Uses Puppeteer key names (e.g. `Enter`, `Tab`, `Escape`, `ArrowDown`, `Space`, `F11`).

```json
{ "action": "keyboardPress", "args": ["Enter"] }
```

```json
{ "action": "keyboardPress", "args": ["Escape"] }
```

```json
{ "action": "keyboardPress", "args": ["F11"] }
```

---

#### `evaluate` — Run JavaScript in Page

Executes arbitrary JavaScript code inside the browser page. This is the most powerful action — use it for DOM manipulation, calling play(), removing overlays, etc.

```json
{ "action": "evaluate", "args": ["document.querySelector('.ad-overlay')?.remove()"] }
```

```json
{ "action": "evaluate", "args": ["document.querySelector('video').play()"] }
```

IIFE pattern for complex logic:

```json
{
  "action": "evaluate",
  "args": ["(() => { const v = document.querySelector('video'); if (v) { v.muted = false; v.play(); } })()"]
}
```

---

#### `screenshot` — Capture a Screenshot

Saves a screenshot of the current page to the specified file path. Defaults to `screenshot.png` if no path is given.

```json
{ "action": "screenshot", "args": ["debug-capture.png"] }
```

---

#### `delay` — Pause Execution

Pauses execution for the specified number of milliseconds. Defaults to 1000 ms if no value is given.

```json
{ "action": "delay", "args": [5000] }
```

---

#### `loop` (action) — Simple Repeat

Repeats a set of nested `steps` a given number of times. This is the **action-based** loop — see also the [control flow `loop`](#loop--repetition) for more advanced looping.

```json
{
  "action": "loop",
  "args": [3],
  "steps": [
    { "action": "keyboardPress", "args": ["ArrowDown"] },
    { "action": "delay", "args": [500] }
  ]
}
```

---

## 🧩 `use` — Macros (Reusable Step Sequences)

Macros let you define named, reusable sequences of steps and call them from any rule. This avoids duplicating the same logic across multiple site rules.

### Defining a Macro

Macros are defined in the top-level `macros` array. Each macro has a `name` and a `steps` array.

```json
{
  "macros": [
    {
      "name": "clickPlay",
      "steps": [
        { "action": "waitForSelector", "args": ["button.play"] },
        { "action": "evaluate", "args": ["document.querySelector('button.play').click()"] }
      ]
    },
    {
      "name": "unmute",
      "steps": [
        { "action": "evaluate", "args": ["(() => { const v = document.querySelector('video'); if (v) v.muted = false; })()"] }
      ]
    }
  ]
}
```

### Calling a Macro

Use the `use` field (instead of `action`) to invoke a macro by name. You can pass arguments via `args`.

```json
{ "use": "clickPlay" }
```

With arguments:

```json
{ "use": "setupVideo", "args": ["{{query.channel}}", "1080"] }
```

### Accessing Macro Arguments

Inside a macro's steps, the passed arguments are available as `args[0]`, `args[1]`, etc. in template expressions:

```json
{
  "macros": [
    {
      "name": "navigateToChannel",
      "steps": [
        { "action": "goto", "args": ["https://example.com/watch/{{args[0]}}"] },
        { "action": "delay", "args": ["{{args[1]}}"] }
      ]
    }
  ],
  "rules": [
    {
      "site": "example.com",
      "steps": [
        { "use": "navigateToChannel", "args": ["{{query.ch}}", "3000"] }
      ]
    }
  ]
}
```

> [!NOTE]
> Macros can contain **any step type** — actions, conditions (`if`), loops, try/catch blocks, and even calls to other macros.

---

## 🔁 Control Flow

Control flow constructs are **step-level properties** — you add them directly to a step object.

### `if` — Conditional Execution

Attach an `if` property to any step to make it execute only when the condition is true. The condition is a JavaScript expression evaluated in the runner's **server-side** context (not the browser page).

```json
{
  "action": "evaluate",
  "args": ["document.querySelector('video').play()"],
  "if": "query.autoplay === 'true'"
}
```

#### Available Context Variables in Conditions

| Variable  | Source          | Description                                | Example                          |
| --------- | --------------- | ------------------------------------------ | -------------------------------- |
| `query`   | `req.query`     | URL query parameters from the stream request | `query.ch`, `query.autoplay`     |
| `params`  | `req.params`    | Express route parameters                   | `params.name`                    |
| `headers` | `req.headers`   | HTTP request headers                       | `headers['user-agent']`          |
| `args`    | Step `args`     | Arguments array on the current step        | `args[0]`, `args[1]`            |
| `i`       | Loop index      | Current iteration index (in for/foreach)   | `i === 0`, `i < 5`              |
| `item`    | Foreach item    | Current item (in foreach loop)             | `item === 'abc'`                |
| `error`   | Catch block     | The caught error object (in catch blocks)  | `error.message`                 |

#### More Condition Examples

Only run if a specific query parameter is present:

```json
{
  "action": "goto",
  "args": ["https://example.com/{{query.ch}}"],
  "if": "query.ch !== undefined"
}
```

Only run on the first loop iteration:

```json
{
  "action": "delay",
  "args": [5000],
  "if": "i === 0"
}
```

---

### `loop` — Repetition (Control Flow)

The top-level `loop` property on a step gives you three loop types: `for`, `while`, and `foreach`.

#### 1. `for` Loop

Repeats steps a fixed number of times. The loop index `i` (starting at 0) is available in the context.

```json
{
  "loop": {
    "type": "for",
    "count": 5,
    "steps": [
      { "action": "keyboardPress", "args": ["ArrowDown"] },
      { "action": "delay", "args": [200] }
    ]
  }
}
```

Using a dynamic count from a query parameter:

```json
{
  "loop": {
    "type": "for",
    "count": "{{query.repeat}}",
    "steps": [
      { "action": "evaluate", "args": ["console.log('Iteration {{i}}')"] }
    ]
  }
}
```

#### 2. `while` Loop

Repeats steps while a condition is true. Has a built-in **safety guard of 500 iterations** to prevent infinite loops.

```json
{
  "loop": {
    "type": "while",
    "condition": "query.keepGoing === 'true'",
    "steps": [
      { "action": "evaluate", "args": ["document.querySelector('video').play()"] },
      { "action": "delay", "args": [2000] }
    ]
  }
}
```

> [!WARNING]
> While loops are capped at **500 iterations** max. If your condition never becomes false, the loop will stop after 500 cycles.

#### 3. `foreach` Loop

Iterates over an array. Each iteration gets `item` (current value) and `i` (index) in context.

```json
{
  "loop": {
    "type": "foreach",
    "each": "['ESPN', 'CNN', 'FOX']",
    "steps": [
      { "action": "evaluate", "args": ["console.log('Channel: {{item}}, Index: {{i}}')"] }
    ]
  }
}
```

---

### `try` / `catch` — Error Handling

Wrap steps in a `try` block to catch errors gracefully. If any step in `try` throws, execution jumps to the `catch` steps. The `error` object is available in the catch context.

```json
{
  "try": [
    { "action": "waitForSelector", "args": [".play-button"] },
    { "action": "evaluate", "args": ["document.querySelector('.play-button').click()"] }
  ],
  "catch": [
    { "action": "evaluate", "args": ["console.warn('Play button not found, trying fallback')"] },
    { "action": "evaluate", "args": ["document.querySelector('video')?.play()"] }
  ]
}
```

> [!NOTE]
> Individual actions already have internal error handling (they log failures and continue). Use `try`/`catch` when you need to run **alternative steps** on failure.

---

## 🧮 Template Expressions (`{{ ... }}`)

Any string value in `args` can contain `{{ expr }}` template expressions. These are evaluated **server-side** (in the runner's context, not in the browser) and replaced with the result before the action executes.

### Syntax

```
{{expression}}
```

The expression is evaluated as JavaScript, with access to the current context variables.

### Examples

| Expression             | Result (given context)                                     |
| ---------------------- | ---------------------------------------------------------- |
| `{{query.ch}}`         | Value of `?ch=` from the stream URL                        |
| `{{query.autoplay}}`   | Value of `?autoplay=` from the stream URL                  |
| `{{args[0]}}`          | First argument passed to the step/macro                    |
| `{{args[1]}}`          | Second argument passed to the step/macro                   |
| `{{i}}`                | Current loop index                                         |
| `{{item}}`             | Current foreach item                                       |
| `{{i + 1}}`            | Loop index + 1 (arithmetic works)                         |
| `{{query.ch || 'default'}}` | Fallback value with JS logical OR                    |

### In Actions

```json
{ "action": "goto", "args": ["https://example.com/watch?ch={{query.ch}}"] }
```

### In Conditions

```json
{ "action": "delay", "args": [1000], "if": "query.ch === '{{query.ch}}'" }
```

### In Loop Counts

```json
{ "loop": { "type": "for", "count": "{{query.repeat}}", "steps": [ ... ] } }
```

> [!IMPORTANT]
> If a `{{expr}}` cannot be evaluated, it is left as-is in the string (e.g. `"{{unknownVar}}"` stays literally `"{{unknownVar}}"`).

---

## 🧰 Full Examples

### Example 1 — Simple Video Site: Wait, Unmute, Fullscreen

```json
{
  "rules": [
    {
      "site": "livestream.example.com",
      "steps": [
        { "action": "delay", "args": [3000] },
        { "action": "waitForSelector", "args": ["video"] },
        { "action": "waitForFunction", "args": ["document.querySelector('video')?.readyState === 4"] },
        { "action": "evaluate", "args": ["(() => { const v = document.querySelector('video'); v.muted = false; v.play(); })()"] },
        { "action": "evaluate", "args": ["document.querySelector('.fullscreen-btn')?.click()"] }
      ]
    }
  ]
}
```

### Example 2 — Login Flow with Try/Catch

```json
{
  "rules": [
    {
      "site": "app.example.com",
      "steps": [
        {
          "try": [
            { "action": "waitForSelector", "args": ["input#email"] },
            { "action": "mouseClick", "args": [500, 400] },
            { "action": "keyboardType", "args": ["user@example.com"] },
            { "action": "keyboardPress", "args": ["Tab"] },
            { "action": "keyboardType", "args": ["mypassword123"] },
            { "action": "keyboardPress", "args": ["Enter"] },
            { "action": "delay", "args": [5000] }
          ],
          "catch": [
            { "action": "evaluate", "args": ["console.warn('Login form not found, may already be logged in')"] }
          ]
        },
        { "action": "waitForSelector", "args": ["video.player"] },
        { "action": "evaluate", "args": ["document.querySelector('video.player').play()"] }
      ]
    }
  ]
}
```

### Example 3 — Conditional Steps with Query Parameters

Stream URL: `/stream?url=https://example.com/live&ch=ESPN&autoplay=true`

```json
{
  "rules": [
    {
      "site": "example.com",
      "steps": [
        { "action": "delay", "args": [2000] },
        {
          "action": "goto",
          "args": ["https://example.com/watch/{{query.ch}}"],
          "if": "query.ch !== undefined"
        },
        {
          "action": "evaluate",
          "args": ["document.querySelector('video').play()"],
          "if": "query.autoplay === 'true'"
        }
      ]
    }
  ]
}
```

### Example 4 — Macros for Reusable Logic

```json
{
  "macros": [
    {
      "name": "dismissOverlays",
      "steps": [
        { "action": "evaluate", "args": ["document.querySelectorAll('.modal-overlay, .cookie-banner, .popup').forEach(el => el.remove())"] },
        { "action": "delay", "args": [500] }
      ]
    },
    {
      "name": "setupVideo",
      "steps": [
        { "action": "waitForSelector", "args": ["video"] },
        { "action": "waitForFunction", "args": ["document.querySelector('video')?.readyState >= 3", "30000"] },
        { "action": "evaluate", "args": ["(() => { const v = document.querySelector('video'); v.muted = false; v.volume = 1.0; v.play(); })()"] }
      ]
    }
  ],
  "rules": [
    {
      "site": "streaming.example.com",
      "steps": [
        { "action": "delay", "args": [3000] },
        { "use": "dismissOverlays" },
        { "use": "setupVideo" }
      ]
    },
    {
      "site": "live.another.com",
      "steps": [
        { "action": "delay", "args": [2000] },
        { "use": "dismissOverlays" },
        { "action": "evaluate", "args": ["document.querySelector('.go-live-btn')?.click()"] },
        { "action": "delay", "args": [3000] },
        { "use": "setupVideo" }
      ]
    }
  ]
}
```

### Example 5 — Foreach Loop Over Channels

```json
{
  "rules": [
    {
      "site": "guide.example.com",
      "steps": [
        {
          "loop": {
            "type": "foreach",
            "each": "['ESPN', 'CNN', 'NBC']",
            "steps": [
              { "action": "evaluate", "args": ["console.log('Processing channel {{i}}: {{item}}')"] },
              { "action": "delay", "args": [500] }
            ]
          }
        }
      ]
    }
  ]
}
```

### Example 6 — For Loop: Press Down Arrow Multiple Times

```json
{
  "rules": [
    {
      "site": "epg.example.com",
      "steps": [
        { "action": "delay", "args": [2000] },
        {
          "loop": {
            "type": "for",
            "count": 5,
            "steps": [
              { "action": "keyboardPress", "args": ["ArrowDown"] },
              { "action": "delay", "args": [300] }
            ]
          }
        },
        { "action": "keyboardPress", "args": ["Enter"] }
      ]
    }
  ]
}
```

### Example 7 — Nested Try/Catch with Macro Fallback

```json
{
  "macros": [
    {
      "name": "fallbackPlayer",
      "steps": [
        { "action": "evaluate", "args": ["document.querySelector('video')?.play()"] },
        { "action": "delay", "args": [2000] }
      ]
    }
  ],
  "rules": [
    {
      "site": "tv.example.com",
      "steps": [
        {
          "try": [
            { "action": "waitForSelector", "args": [".premium-player"] },
            { "action": "evaluate", "args": ["document.querySelector('.premium-player .play-btn').click()"] }
          ],
          "catch": [
            { "action": "evaluate", "args": ["console.warn('Premium player not found, using fallback')"] },
            { "use": "fallbackPlayer" }
          ]
        }
      ]
    }
  ]
}
```

### Example 8 — Remove Ads with a While Loop

```json
{
  "rules": [
    {
      "site": "freestream.example.com",
      "steps": [
        { "action": "delay", "args": [3000] },
        {
          "loop": {
            "type": "while",
            "condition": "true",
            "steps": [
              { "action": "evaluate", "args": ["document.querySelectorAll('.ad-overlay, .ad-banner').forEach(el => el.remove())"] },
              { "action": "delay", "args": [10000] }
            ]
          }
        }
      ]
    }
  ]
}
```

> [!WARNING]
> The above `while` loop with `"condition": "true"` will run until the **500-iteration safety limit** is hit (roughly 83 minutes with a 10 s delay per iteration). Design your condition to exit when appropriate.

---

## 📥 Loading & Refreshing Rules

Rules are loaded from the `--rules` (`-r`) CLI option, which can be a **URL** or **local file path**:

```bash
# From a remote URL (default)
node main.js --rules https://raw.githubusercontent.com/user/repo/main/automation.json

# From a local file
node main.js --rules ./my-rules.json
```

Rules are automatically re-fetched on a timer set by `--rulesRefreshTimer` (`-t`), default **15 minutes**:

```bash
# Refresh every 5 minutes
node main.js --rules https://example.com/rules.json --rulesRefreshTimer 5
```

---

## 📝 Step Anatomy Quick Reference

A step object can have the following fields:

```
┌─────────────────────────────────────────────────────────┐
│  STEP OBJECT                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Action step:                                           │
│    { "action": "...", "args": [...], "if": "..." }      │
│                                                         │
│  Macro call:                                            │
│    { "use": "macroName", "args": [...], "if": "..." }   │
│                                                         │
│  Loop:                                                  │
│    { "loop": { "type": "...", ... }, "if": "..." }      │
│                                                         │
│  Try/Catch:                                             │
│    { "try": [...], "catch": [...], "if": "..." }        │
│                                                         │
│  Action-based loop:                                     │
│    { "action": "loop", "args": [count], "steps": [...] }│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> [!TIP]
> The `if` condition can be added to **any** step type — action, macro call, loop, or try/catch.

---

## 💡 Tips & Best Practices

- **All `args` must be arrays** — e.g. `"args": ["video"]`, not `"args": "video"`.
- **Use `delay` between interactions** — Many sites need time to load content between actions. Adding `{ "action": "delay", "args": [2000] }` prevents race conditions.
- **Use `waitForSelector` before interacting** — Always wait for elements to exist before clicking or evaluating on them.
- **Use `waitForFunction` for video readiness** — Check `readyState >= 3` (or `=== 4`) before trying to play.
- **Use `evaluate` with IIFEs for complex logic** — Wrap multi-statement code in `(() => { ... })()`.
- **Use `try`/`catch` for unreliable elements** — Popups, modals, and ads may or may not be present.
- **Macros reduce duplication** — Extract common patterns (unmuting, overlay removal, video setup) into macros.
- **Template expressions are server-side** — `{{ }}` expressions resolve before the action runs, using the request context (query params, headers, etc.), not the browser's DOM.
- **Rules are matched in order** — The first matching rule wins. Put more specific patterns before general ones.

---
