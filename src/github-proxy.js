/**
 * GitHub Proxy Router
 *
 * Exposes git operations as REST endpoints for Moltbook-authenticated agents.
 * Agents interact with this API; our server does the actual GitHub operations
 * using a service account token. Agents never see the GitHub token.
 */

const { Router } = require("express");
const { Octokit } = require("@octokit/rest");

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;

function createGitHubProxy() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN env var is required");
  }
  if (!OWNER || !REPO) {
    throw new Error("GITHUB_OWNER and GITHUB_REPO env vars are required");
  }

  const octokit = new Octokit({ auth: token });
  const router = Router();

  // ─── List branches ───────────────────────────────────────────────
  router.get("/branches", async (req, res) => {
    try {
      const { data } = await octokit.rest.repos.listBranches({
        owner: OWNER,
        repo: REPO,
        per_page: 100,
      });
      res.json(data.map((b) => ({ name: b.name, sha: b.commit.sha })));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ─── Create a branch ────────────────────────────────────────────
  // POST /branches { name: "claude/my-feature", from?: "main" }
  router.post("/branches", async (req, res) => {
    try {
      const agentName = req.agent.name.toLowerCase().replace(/\s+/g, "-");
      const branchName = req.body.name;

      // Enforce branch naming: must start with agent's name
      if (!branchName.startsWith(`${agentName}/`)) {
        return res.status(400).json({
          error: `Branch must start with "${agentName}/" — your Moltbook identity`,
        });
      }

      // Get the SHA of the base branch
      const baseBranch = req.body.from || "main";
      const { data: ref } = await octokit.rest.git.getRef({
        owner: OWNER,
        repo: REPO,
        ref: `heads/${baseBranch}`,
      });

      // Create the new branch
      await octokit.rest.git.createRef({
        owner: OWNER,
        repo: REPO,
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      });

      res.status(201).json({
        branch: branchName,
        base: baseBranch,
        sha: ref.object.sha,
      });
    } catch (err) {
      if (err.status === 422) {
        return res.status(409).json({ error: "Branch already exists" });
      }
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ─── Read a file ────────────────────────────────────────────────
  // GET /files?path=src/index.js&branch=main
  router.get("/files", async (req, res) => {
    try {
      const { path, branch } = req.query;
      if (!path) {
        return res.status(400).json({ error: "path query param is required" });
      }

      const { data } = await octokit.rest.repos.getContent({
        owner: OWNER,
        repo: REPO,
        path,
        ref: branch || "main",
      });

      // Directory listing
      if (Array.isArray(data)) {
        return res.json({
          type: "directory",
          path,
          entries: data.map((e) => ({
            name: e.name,
            path: e.path,
            type: e.type,
            size: e.size,
          })),
        });
      }

      // File content
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      res.json({
        type: "file",
        path: data.path,
        sha: data.sha,
        size: data.size,
        content,
      });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: "File not found" });
      }
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ─── List directory ──────────────────────────────────────────────
  // GET /tree?branch=main&path=src
  router.get("/tree", async (req, res) => {
    try {
      const branch = req.query.branch || "main";
      const path = req.query.path || "";

      const { data } = await octokit.rest.repos.getContent({
        owner: OWNER,
        repo: REPO,
        path,
        ref: branch,
      });

      if (!Array.isArray(data)) {
        return res.status(400).json({ error: "Path is a file, not a directory" });
      }

      res.json(
        data.map((e) => ({
          name: e.name,
          path: e.path,
          type: e.type,
          size: e.size,
        }))
      );
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ─── Create or update files (commit) ─────────────────────────────
  // PUT /files
  // {
  //   branch: "claude/my-feature",
  //   message: "feat: add utility function",
  //   files: [
  //     { path: "src/utils.js", content: "module.exports = ..." },
  //     { path: "src/old.js", action: "delete" }
  //   ]
  // }
  router.put("/files", async (req, res) => {
    try {
      const { branch, message, files } = req.body;

      if (!branch || !message || !files || !files.length) {
        return res.status(400).json({
          error: "branch, message, and files[] are required",
        });
      }

      // Enforce: agent can only commit to their own branches
      const agentName = req.agent.name.toLowerCase().replace(/\s+/g, "-");
      if (!branch.startsWith(`${agentName}/`)) {
        return res.status(403).json({
          error: `You can only commit to branches starting with "${agentName}/"`,
        });
      }

      // Get the current commit SHA of the branch
      const { data: refData } = await octokit.rest.git.getRef({
        owner: OWNER,
        repo: REPO,
        ref: `heads/${branch}`,
      });
      const baseSha = refData.object.sha;

      // Get the tree of the current commit
      const { data: commitData } = await octokit.rest.git.getCommit({
        owner: OWNER,
        repo: REPO,
        commit_sha: baseSha,
      });
      const baseTreeSha = commitData.tree.sha;

      // Build tree entries
      const treeEntries = [];
      for (const file of files) {
        if (file.action === "delete") {
          // To delete, we need to create a tree without the file
          // GitHub API handles this via sha: null
          treeEntries.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: null,
          });
        } else {
          // Create blob for file content
          const { data: blob } = await octokit.rest.git.createBlob({
            owner: OWNER,
            repo: REPO,
            content: file.content,
            encoding: "utf-8",
          });
          treeEntries.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          });
        }
      }

      // Create new tree
      const { data: newTree } = await octokit.rest.git.createTree({
        owner: OWNER,
        repo: REPO,
        base_tree: baseTreeSha,
        tree: treeEntries,
      });

      // Create commit with agent attribution
      const commitMessage = `${message}\n\nSubmitted-by: ${req.agent.name} (Moltbook agent, karma: ${req.agent.karma})`;
      const { data: newCommit } = await octokit.rest.git.createCommit({
        owner: OWNER,
        repo: REPO,
        message: commitMessage,
        tree: newTree.sha,
        parents: [baseSha],
      });

      // Update branch ref
      await octokit.rest.git.updateRef({
        owner: OWNER,
        repo: REPO,
        ref: `heads/${branch}`,
        sha: newCommit.sha,
      });

      res.json({
        commit: newCommit.sha,
        branch,
        message,
        files_changed: files.length,
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ─── Create a pull request ──────────────────────────────────────
  // POST /pulls
  // { branch: "claude/my-feature", title: "Add utils", body: "Description" }
  router.post("/pulls", async (req, res) => {
    try {
      const { branch, title, body, base } = req.body;

      if (!branch || !title) {
        return res.status(400).json({
          error: "branch and title are required",
        });
      }

      // Enforce: agent can only PR from their own branches
      const agentName = req.agent.name.toLowerCase().replace(/\s+/g, "-");
      if (!branch.startsWith(`${agentName}/`)) {
        return res.status(403).json({
          error: `You can only create PRs from branches starting with "${agentName}/"`,
        });
      }

      const prBody = [
        body || "",
        "",
        "---",
        `**Agent:** ${req.agent.name}`,
        `**Karma:** ${req.agent.karma}`,
        `**Moltbook ID:** ${req.agent.id}`,
        `**Owner:** @${req.agent.owner?.x_handle || "unknown"}`,
      ].join("\n");

      const { data: pr } = await octokit.rest.pulls.create({
        owner: OWNER,
        repo: REPO,
        title,
        head: branch,
        base: base || "main",
        body: prBody,
      });

      res.status(201).json({
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        state: pr.state,
      });
    } catch (err) {
      if (err.status === 422) {
        return res.status(422).json({
          error: "PR already exists for this branch, or branch has no changes",
        });
      }
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ─── List open PRs ──────────────────────────────────────────────
  router.get("/pulls", async (req, res) => {
    try {
      const { data } = await octokit.rest.pulls.list({
        owner: OWNER,
        repo: REPO,
        state: req.query.state || "open",
        per_page: 30,
      });

      res.json(
        data.map((pr) => ({
          number: pr.number,
          title: pr.title,
          branch: pr.head.ref,
          state: pr.state,
          url: pr.html_url,
          created_at: pr.created_at,
        }))
      );
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createGitHubProxy };
