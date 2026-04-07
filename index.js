import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import chatRoutes from "./routes/chatRoutes.js";
import { createChatMessage, setSocketIO } from "./controllers/chatController.js";
import userRoutes from "./routes/userRoutes.js";
import { connectDB } from "./config/db.js";

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "..", "frontend");

setSocketIO(io);

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

      const senderId = savedMessage.sender?._id ? String(savedMessage.sender._id) : "";
      const receiverId = savedMessage.receiver?._id ? String(savedMessage.receiver._id) : "";

      const senderRoom = `user:${senderId}`;
      const receiverRoom = `user:${receiverId}`;

      io.to(senderRoom).to(receiverRoom).emit("message:new", { message: savedMessage });
      ack({ ok: true, message: savedMessage });
    } catch (error) {
      ack({ ok: false, message: error.message || "Message send failed" });
    }
  });
});

// Parse JSON body from incoming requests.
app.use(express.json());
app.use(express.static(frontendDir));
app.use("/frontend", express.static(frontendDir));

// API routes
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendDir, "register.html"));
});

app.get("/register.html", (_req, res) => {
  res.sendFile(path.join(frontendDir, "register.html"));
});

app.get("/login.html", (_req, res) => {
  res.sendFile(path.join(frontendDir, "login.html"));
});

app.get("/chatdashboard.html", (_req, res) => {
  res.sendFile(path.join(frontendDir, "chatdashboard.html"));
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
  try {
    await connectDB();

    server.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
