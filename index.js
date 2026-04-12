import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import chatRoutes from "./routes/chatRoutes.js";
import { createChatMessage, markConversationRead, setSocketIO } from "./controllers/chatController.js";
import userRoutes from "./routes/userRoutes.js";
import { setUserSocketIO } from "./controllers/userController.js";
import { connectDBWithRetry } from "./config/db.js";
import User from "./models/User.js";

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const frontendOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const knownProductionOrigins = [
  "https://chatingeazy.vercel.app",
  "https://backendchat-nu8b.onrender.com"
];
const localOrigins = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];
const allowedOrigins = new Set([
  ...frontendOrigins,
  ...knownProductionOrigins,
  ...localOrigins
]);
const isAllowedOrigin = (origin = "") => {
  if (!origin || origin === "null") {
    return true;
  }

  if (allowedOrigins.has(origin)) {
    return true;
  }

  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
};
const corsConfig = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, origin && origin !== "null" ? origin : "*");
      return;
    }

    callback(new Error(`Origin ${origin || "unknown"} is not allowed by CORS`));
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
};
const io = new Server(server, {
  cors: corsConfig
});
const activeSocketsByUser = new Map();

const toId = (value) => (value ? String(value) : "");
const getSocketSet = (userId) => {
  const id = toId(userId);
  if (!id) return null;
  if (!activeSocketsByUser.has(id)) activeSocketsByUser.set(id, new Set());
  return activeSocketsByUser.get(id);
};
const setUserPresence = async (userId, isActive) => {
  const id = toId(userId);
  if (!id) return;
  await User.findByIdAndUpdate(id, {
    $set: {
      isLoggedIn: Boolean(isActive),
      lastActiveAt: new Date()
    }
  }).catch(() => {});
  io.to(`user:${id}`).emit("presence:updated", { userId: id, isLoggedIn: Boolean(isActive) });
  io.emit("network:refresh", { scope: "global" });
};
const updatePresenceForSocket = async (socket, isActive) => {
  const userId = toId(socket.data.userId);
  if (!userId) return;
  const socketSet = getSocketSet(userId);
  if (!socketSet) return;

  if (isActive) socketSet.add(socket.id);
  else socketSet.delete(socket.id);

  const userIsActive = socketSet.size > 0;
  if (!userIsActive) activeSocketsByUser.delete(userId);
  await setUserPresence(userId, userIsActive);
};

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Another backend instance is likely running on http://localhost:${port}. Stop it before starting a new one.`);
    process.exit(1);
  }

  console.error("Server failed to start:", error.message || error);
  process.exit(1);
});

setSocketIO(io);
setUserSocketIO(io);

io.on("connection", (socket) => {
  socket.on("user:join", (payload = {}) => {
    const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
    if (!userId) {
      return;
    }

    socket.data.userId = userId;
    socket.join(`user:${userId}`);
  });

  socket.on("user:presence", async (payload = {}, ack = () => {}) => {
    try {
      await updatePresenceForSocket(socket, Boolean(payload.active));
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, message: error.message || "Could not update presence" });
    }
  });

  socket.on("message:send", async (payload = {}, ack = () => {}) => {
    try {
      const savedMessage = await createChatMessage(payload.senderId, payload.receiverId, payload.text);

      const receiverId = savedMessage.receiver?._id ? String(savedMessage.receiver._id) : "";
      const receiverRoom = `user:${receiverId}`;

      io.to(receiverRoom).emit("message:new", { message: savedMessage });
      ack({ ok: true, message: savedMessage });
    } catch (error) {
      ack({ ok: false, message: error.message || "Message send failed" });
    }
  });

  socket.on("messages:read", async (payload = {}, ack = () => {}) => {
    try {
      await markConversationRead(payload.userId, payload.chatWith);
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, message: error.message || "Could not mark messages as read" });
    }
  });

  socket.on("typing:start", (payload = {}, ack = () => {}) => {
    try {
      const senderId = toId(payload.senderId);
      const receiverId = toId(payload.receiverId);
      if (!senderId || !receiverId) {
        ack({ ok: false, message: "senderId and receiverId are required" });
        return;
      }
      io.to(`user:${receiverId}`).emit("typing:start", { senderId, receiverId });
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, message: error.message || "Could not broadcast typing state" });
    }
  });

  socket.on("typing:stop", (payload = {}, ack = () => {}) => {
    try {
      const senderId = toId(payload.senderId);
      const receiverId = toId(payload.receiverId);
      if (!senderId || !receiverId) {
        ack({ ok: false, message: "senderId and receiverId are required" });
        return;
      }
      io.to(`user:${receiverId}`).emit("typing:stop", { senderId, receiverId });
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, message: error.message || "Could not clear typing state" });
    }
  });

  socket.on("disconnect", () => {
    updatePresenceForSocket(socket, false).catch(() => {});
  });
});

// Parse JSON body from incoming requests.
app.use(cors(corsConfig));
app.use(express.json());

// API routes
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    message: "Chateazy backend is running",
    status: "ok"
  });
});

// Return a clear error for unknown routes.
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Centralized error handler.
app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ message: err.message || "Internal server error" });
});

const startServer = async () => {
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  connectDBWithRetry().catch(() => {});
};

startServer();
