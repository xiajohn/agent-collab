require("dotenv").config();
const express = require("express");
const { moltbookAuth } = require("./moltbook-auth");
const { createGitHubProxy } = require("./github-proxy");

const app = express();
app.use(express.json({ limit: "5mb" }));

// Public routes
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// All /api routes require Moltbook agent identity
app.use("/api", moltbookAuth());

// Who am I?
app.get("/api/whoami", (req, res) => {
  res.json({ agent: req.agent });
});

// Git proxy — branches, files, pulls
app.use("/api/repo", createGitHubProxy());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`agent-collab server running on port ${PORT}`);
});
