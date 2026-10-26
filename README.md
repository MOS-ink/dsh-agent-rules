# dsh-agent-rules

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that adds a **Rules & Memory** page to Settings and keeps long-lived preset rules in one editable list.

Rules are rendered into the managed block of `~/.dsh/AGENTS.md`. The bundled `@deepseek-ai/dsh-agent-instructions` loader reads that file as workspace instructions on the first request of every session, so the rules apply globally without occupying the system prompt.

## Behaviour

- **One list, one file.** The panel writes `~/.dsh/agent-rules.json` and re-renders the managed block of `~/.dsh/AGENTS.md` on every change.
- **Manual content is preserved.** Everything outside the `<!-- dsh-agent-rules:start -->` / `<!-- dsh-agent-rules:end -->` markers is left untouched. When hand-written content is detected, the panel offers to import it into the list.
- **Disabled rules stay on disk.** Turning a rule off removes it from `AGENTS.md` but keeps its text and ID in the JSON store.
- **No system-prompt rewrite.** The plugin does not hook prompt assembly. It writes the file the official instruction loader already reads.
- **Scope.** Rules take effect when a new conversation starts. A conversation that is already open keeps the instructions it was created with.

## Install

From the plugin page, add this market index source and install `dsh-agent-rules`:

```
https://cdn.jsdelivr.net/gh/MOS-ink/dsh-agent-rules@main/market/index.json
```

The raw GitHub URL serves the same document without the CDN cache:

```
https://raw.githubusercontent.com/MOS-ink/dsh-agent-rules/main/market/index.json
```

From a checkout:

```powershell
dsh plugin --profile <name> add link:<absolute path to this directory>
```

Then add `dsh-agent-rules` to `dsh.profile.bundles` in the profile's `package.json` and restart the app. The client half is served by the host; it is not picked up by a page refresh.

## Usage

Settings → **规则与记忆** (Rules & Memory).

| Control | Effect |
| --- | --- |
| Add rule | Opens an editor at the top of the list; saving writes both files |
| Click rule text / gear icon | Edit in place |
| Dot toggle | Disable without deleting; the rule stops being written to `AGENTS.md` |
| Trash icon | Delete the rule from the store and from `AGENTS.md` |
| Import from AGENTS.md | Shown when hand-written content exists outside the managed block |

## Storage

`~/.dsh/agent-rules.json`

```json
{
  "version": 1,
  "rules": [
    { "id": "r1", "text": "Answer with the conclusion first.", "enabled": true }
  ]
}
```

`~/.dsh/AGENTS.md` — the rendered block:

```markdown
<!-- dsh-agent-rules:start -->
- Answer with the conclusion first.
<!-- dsh-agent-rules:end -->
```

Multi-line rules are indented as continuation lines of the same list item.

## Context sources shown in the panel

| Source | Loaded by |
| --- | --- |
| `~/.dsh/AGENTS.md` | `dsh-agent-instructions`, user-global scope |
| `~/.agents/AGENTS.md` | shared agents root, folded when byte-identical |
| `CLAUDE.md` per project directory | project scope only; the user-global scope has no `CLAUDE.md` |

## Market index

`market/index.json` follows plugin market index format 1. It is validated by `@deepseek-ai/dsh-plugin-market-index` before publication:

```powershell
node scripts/validate-index.mjs market/index.json https://raw.githubusercontent.com/MOS-ink/dsh-agent-rules/main/market/index.json
```

## Development

```powershell
node --test
node --check index.js
node --check client.js
```

The host half registers one prefix route, `/dsh-agent-rules`, guarded by `connection.requestRejection`. The client half registers a `settings.section` entry with id `agent-rules`.

| File | Role |
| --- | --- |
| `rules.js` | Data model, markdown rendering, block merge, import parsing (no I/O) |
| `index.js` | Host plugin: route, store, file rendering |
| `client.js` | Settings page (`window.__ModuleLoader__` bundle) |

## License

MIT
