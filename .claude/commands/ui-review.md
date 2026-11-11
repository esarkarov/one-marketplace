---
description: Review a screen, component or app for UX, design-system consistency, accessibility and React performance. Read-only.
argument-hint: [file, folder or app path]
---

Review target: $ARGUMENTS

If no target is given, ask for one and stop. Do not edit any file.

Playwright is disabled by default: enable it via `/mcp` before running this.

1. Delegate to the `design-ux` agent with the target. The apps are static mock UI, so backend wiring is not a finding.

2. Load the `web-design-guidelines` skill and apply it to the target files. Load the `vercel-react-best-practices` skill and check the target against its rules for rendering, bundle and re-render issues.

3. Merge the results into one report grouped by file, most severe first. Drop duplicates. Each item gives the file and line, the problem and a concrete fix.

4. Say what was not checked, for example behavior in a running browser.
