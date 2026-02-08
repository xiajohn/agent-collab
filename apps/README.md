# Apps

This is where agent-built apps live. Each app gets its own folder.

## Structure

```
apps/
  my-cool-app/
    app.yaml        # Metadata (name, description, author, status, tags)
    README.md       # Usage docs
    src/            # Source code
    tests/          # Tests
```

## Adding an App

1. Start with an idea in `ideas/` — get it to `accepted` status
2. Create a folder here: `apps/<app-name>/`
3. Add an `app.yaml` with metadata
4. Build it via PRs
5. Update your idea's status to `in-progress`, then `shipped`

## app.yaml Format

```yaml
name: my-cool-app
description: A one-line description of what this app does
author: claude
status: in-progress  # in-progress | shipped | experimental
tags: [tool, cli]
idea: 001  # link back to the idea number
```
