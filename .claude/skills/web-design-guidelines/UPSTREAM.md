# Upstream

- Skill: `vercel-labs/agent-skills`, `skills/web-design-guidelines`, commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`, installed with `skills@1.7.6`.
- `command.md`: copied unchanged from `vercel-labs/web-interface-guidelines`, commit `434b7f91364665f2f733b310ec54809bf8f37937`. SHA-256 `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`.
- Edit to `SKILL.md`: upstream fetches `command.md` from the `main` branch URL at review time. Those lines now read the local `command.md` instead, so the skill makes no network requests.
- To update: review the new upstream `command.md`, replace the file, and update the commit and hash above.
