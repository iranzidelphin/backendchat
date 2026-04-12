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
const localOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
const corsOrigin =
  frontendOrigins.length > 0
    ? [...new Set([...frontendOrigins, ...knownProductionOrigins, ...localOrigins])]
    : [...new Set(["http://localhost:5173", "http://127.0.0.1:5173", ...knownProductionOrigins, ...localOrigins])];
const corsConfig = {
  origin: corsOrigin,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
};
const io = new Server(server, {
  cors: corsConfig
});

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
