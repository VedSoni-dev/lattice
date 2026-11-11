# Composable Lattice skills

Lattice skills describe work independently of the client that performs it. Codex, Claude Code, Cursor, and other compatible MCP clients use the same tools and approval model. Capability labels such as “edit typography” or “read a brief” express requirements; they do not claim that a specific app integration exists.

## Progressive loading

1. `search_skills` returns title, description, use condition, outcome, author, version, capability needs, and child count. No methods or full definitions.
2. `inspect_skill(id, version?)` returns a node's discovery data and immediate child summaries. Child bodies remain unloaded.
3. `borrow_skill(id, version?, parent_id?, parent_version?)` loads one approved node with its method and checks. Child nodes remain references. The caller loads required children and applicable optional children separately.

The visual library uses the same structure: expand a node to fetch that node. A shared child can belong to several parents; the UI displays a tree over an underlying dependency graph.

## Definition v1

Existing flat skills remain valid with an empty definition. A structured skill adds:

```json
{
  "schema_version": 1,
  "use_when": "Building a new page",
  "outcome": "A clear, usable main journey",
  "inputs": ["Brief", "Real content"],
  "checks": ["The primary action works"],
  "capabilities": ["Edit an interface"],
  "dependencies": [
    {
      "id": "<existing approved skill UUID>",
      "version": 1,
      "required": true,
      "when": "Before handing off the page"
    }
  ]
}
```

Title, description, method, category, author, and version remain fields on the skill. Structured fields are optional. A skill supports at most 12 direct children and 144 traversed links. Self-dependencies, including indirect paths back to the parent, are rejected. The server validates references, versions, and access independently of MCP schema validation.

## Approval and version semantics

- Proposing creates a private draft. New child drafts must be approved before a parent can reference them.
- Approval freezes the method and definition at that version in `skill_versions`. Editing creates a new draft version; it never edits an approved snapshot.
- A parent stores exact child versions. Updating a child does not update parents. The editor lets the author explicitly choose a newer version, then approve the changed parent.
- Historical content does not preserve historical access. Reads always check the current skill's visibility, approval state, and current team membership. Archiving, making a skill private, or losing membership can make a pinned child unavailable.
- Sharing a parent requires all referenced descendants to be approved and shared with the same team. Missing children are reported, not silently replaced or copied across permissions.
- Approval cards show the method, checks, and child references. Hosts without inline MCP Apps use the authenticated review URL. Agent tools never approve automatically.

## Provenance

Borrow events record the user, skill, loaded version, and optional parent/version. A claimed parent-child relationship is validated against the frozen parent. The library displays the current user's recent method loads. A load is not evidence that the agent executed every step or achieved the outcome.

## Installation and adapters

`/install` provides client-specific and auto-detection prompts. `/install.txt` is the portable prompt. The prompt installs only the current client, preserves configuration, adds a bounded project instruction, verifies tool access, and leaves OAuth and method approval to the person.

- Codex: remote HTTP MCP plus a marked section in project `AGENTS.md`.
- Claude Code: remote HTTP MCP plus a marked section in project `CLAUDE.md`.
- Cursor: merged user MCP configuration plus project `.cursor/rules/lattice.mdc`.
- Claude web/desktop: manual custom-connector guidance where the account supports it; no invented filesystem access.

Figma, Palmier Pro, Canva, and custom agents can later adapt this contract to their own supported tool and instruction interfaces. Dedicated integrations are not implemented in this release.

## Storage and rollout

Apply `db/002_skill_trees.sql` after the initial schema with `scripts/migrate-skill-trees.mjs`. It uses a transaction, an advisory lock, and a checksummed migration record. Existing public RPC names remain stable; the previous implementations move into the private schema. Run `npm run build` and `npm test` before deployment.

Compatibility checks cover MCP protocol behavior using the standard SDK and Codex/Claude/Cursor client identities. These are not substitutes for interactive OAuth testing in each installed app.

## Workspace maps

`/app?view=tree` shows approved skills in the selected workspace. Team maps include only skills shared with that team; Personal includes only the viewer’s private approved skills. Shared authored skills belong to their team map. Categories form radial branches; actual dependency edges distinguish required and optional children. Cross-workspace references do not pull nodes into the map. Selecting a child loads its pinned version through the existing ACL-checked `skill_inspect` endpoint.

Workspace and selected node/version can be deep-linked. Search, keyboard node selection, a native skill selector, zoom, and an internally scrollable map support small screens and larger graphs. `/demo?view=tree` uses browser-local sample data.
