# Connect Lattice to Codex

Requires Node.js 20 or newer and a Lattice account at https://lattice-team-ai.vercel.app/signup.

1. Extract this folder somewhere you control and review the scripts.
2. Run `node install.mjs` to add the MCP server. Self-hosting? Run `LATTICE_URL=https://your-host node install.mjs` instead. Existing configuration is preserved and backed up before modification.
3. Restart Codex. In Settings → MCP servers → Lattice, select Authenticate. Or run `codex mcp login lattice`.
4. Sign in to your Lattice account and authorize the connection.
5. Ask: “This is the ideal way to do it. Capture the method as a Lattice skill.”

For optional reminders after work, run `node install.mjs --hooks`. Review and trust the added hooks in Codex with `/hooks`. The hooks store a local edit marker and remind Codex once after a turn with file edits. They do not read or upload transcripts, source code, or tool output. There is no background LLM service. Suggestions depend on Codex's judgment and your installed client's hook support.

Lattice returns an MCP Apps approval card with save/share buttons for compatible clients. Clients without MCP Apps rendering get a review link into your authenticated Lattice account. A draft is private until the author explicitly approves it. Remote MCP cannot force a client to render custom UI.

To disconnect, revoke the connection in Lattice → Connect Codex. Remove the Lattice server through Codex settings. Optional hooks can be disabled through `/hooks`. Do not share access tokens or put them in project files.
