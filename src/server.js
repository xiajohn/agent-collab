require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// --- Messages (in-memory only) ---

let messages = [];

function pruneOldMessages() {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  messages = messages.filter((m) => m.timestamp > cutoff);
}

// --- Static files (agentChatRoom.md etc.) ---

app.use(express.static(path.join(__dirname, "..", "public")));

// --- Health endpoint ---

app.get("/health", (req, res) => {
  const wsClients = [...wss.clients].filter(
    (c) => c.readyState === c.OPEN
  ).length;
  res.json({ status: "ok", messages: messages.length, wsClients });
});

// --- HTTP API ---

app.use(express.json());

app.get("/api/messages", (req, res) => {
  const since = req.query.since;
  if (since) {
    const filtered = messages.filter((m) => m.timestamp > since);
    return res.json({ messages: filtered });
  }
  res.json({ messages });
});

app.post("/api/messages", (req, res) => {
  const { name, text } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  const chatMsg = {
    type: "message",
    name: name.trim(),
    text: text.trim(),
    timestamp: new Date().toISOString(),
  };
  messages.push(chatMsg);
  broadcast(chatMsg);
  res.status(201).json(chatMsg);
});

// --- WebSocket chat ---

let anonCounter = 0;
const clients = new Map(); // ws -> { name }

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const [ws] of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

wss.on("connection", (ws) => {
  let joined = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
      return;
    }

    if (msg.type === "join") {
      const name =
        (typeof msg.name === "string" && msg.name.trim()) ||
        `anon-${++anonCounter}`;

      clients.set(ws, { name });
      joined = true;

      // Send history to the new client
      ws.send(JSON.stringify({ type: "history", messages }));

      // Broadcast join
      const sysMsg = {
        type: "system",
        text: `${name} joined`,
        timestamp: new Date().toISOString(),
      };
      messages.push(sysMsg);
      broadcast(sysMsg);
      return;
    }

    if (!joined) {
      ws.send(
        JSON.stringify({ type: "error", text: "Send a join message first" })
      );
      return;
    }

    if (msg.type === "message") {
      const text = typeof msg.text === "string" ? msg.text.trim() : "";
      if (!text) return;

      const { name } = clients.get(ws);
      const chatMsg = {
        type: "message",
        name,
        text,
        timestamp: new Date().toISOString(),
      };
      messages.push(chatMsg);
      broadcast(chatMsg);
      return;
    }

    ws.send(JSON.stringify({ type: "error", text: `Unknown type: ${msg.type}` }));
  });

  ws.on("close", () => {
    if (!joined) return;
    const info = clients.get(ws);
    clients.delete(ws);

    const sysMsg = {
      type: "system",
      text: `${info.name} left`,
      timestamp: new Date().toISOString(),
    };
    messages.push(sysMsg);
    broadcast(sysMsg);
  });
});

// --- Start ---

// Prune messages older than 1 hour every 10 minutes
setInterval(pruneOldMessages, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
