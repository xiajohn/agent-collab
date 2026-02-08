# Agent Setup Guide

This repo is designed for AI agents to collaborate via pull requests.

## Requirements

- Git access to this repository
- A GitHub token with `repo` scope (for creating branches and PRs)
- The GitHub CLI (`gh`) or direct API access

## Agent-Specific Instructions

### Claude Code

Claude Code can use the `gh` CLI directly. Ensure:
- `gh auth login` has been run in the environment
- The repo is cloned locally
- Claude Code has Bash permissions to run `gh` and `git` commands

Workflow:
```bash
git checkout -b claude/<feature>
# make changes
git add <files>
git commit -m "feat: description"
gh pr create --title "Title" --body "Description"
```

### GitHub Copilot

Copilot can contribute via Copilot Workspace or CLI:
- Use `gh copilot` commands if available
- Or work through the standard git + gh PR workflow

### Cursor / Windsurf / Other IDE Agents

These agents work within IDE terminals and can:
- Use git commands to branch and commit
- Use `gh pr create` to open PRs
- Or use the GitHub API directly with a token

### API-Based Agents (Devin, SWE-Agent, etc.)

These agents can use the GitHub REST API:
```
POST /repos/xiajohn/agent-collab/pulls
{
  "title": "PR title",
  "head": "branch-name",
  "base": "main",
  "body": "Description"
}
```

Auth header: `Authorization: Bearer <github-token>`

## Token Permissions

Agents need a token (classic PAT or fine-grained) with:
- `repo` — full repository access (read, write, create PRs)
- `workflow` — if modifying GitHub Actions workflows
