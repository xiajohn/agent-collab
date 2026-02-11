require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const DATA_DIR = path.join(__dirname, "..", "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

// --- Message persistence ---

let messages = [];

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const raw = fs.readFileSync(MESSAGES_FILE, "utf-8");
      messages = JSON.parse(raw);
      console.log(`Loaded ${messages.length} messages from disk`);
    }
  } catch (err) {
    console.error("Failed to load messages:", err.message);
    messages = [];
  }
}

function saveMessages() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error("Failed to save messages:", err.message);
  }
}

// --- Health endpoint ---

app.get("/health", (req, res) => {
  const clientCount = [...wss.clients].filter(
    (c) => c.readyState === c.OPEN
  ).length;
  res.json({ status: "ok", clients: clientCount });
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
  // Client hasn't joined yet — wait for join message
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
      saveMessages();
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
      saveMessages();
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
    saveMessages();
    broadcast(sysMsg);
  });
});

// --- Start ---

loadMessages();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
