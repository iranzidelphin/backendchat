import Message from "../models/Message.js";
import User from "../models/User.js";

const normalizeValue = (value) => (typeof value === "string" ? value.trim() : "");
let ioInstance = null;

const serializeUser = (userValue) => {
  if (!userValue) {
    return null;
  }

  // Populated user document/object
  if (typeof userValue === "object" && userValue._id) {
    return {
      _id: String(userValue._id),
      username: userValue.username,
      email: userValue.email
    };
  }

  // Fallback: raw ObjectId/string
  return { _id: String(userValue) };
};

const serializeMessage = (messageValue) => {
  const message = typeof messageValue?.toObject === "function" ? messageValue.toObject() : messageValue;

  return {
    _id: String(message._id),
    sender: serializeUser(message.sender),
    receiver: serializeUser(message.receiver),
    text: message.text,
    createdAt: message.createdAt
  };
};

export const setSocketIO = (io) => {
  ioInstance = io;
};

const emitSocketEvent = (eventName, payload) => {
  if (ioInstance) {
    ioInstance.emit(eventName, payload);
  }
};

export const createChatMessage = async (senderId, receiverId, text) => {
  const normalizedSenderId = normalizeValue(senderId);
  const normalizedReceiverId = normalizeValue(receiverId);
  const normalizedText = normalizeValue(text);

  if (!normalizedSenderId || !normalizedReceiverId || !normalizedText) {
    const error = new Error("senderId, receiverId and text are required");
    error.statusCode = 400;
    throw error;
  }

  const sender = await User.findById(normalizedSenderId);
  const receiver = await User.findById(normalizedReceiverId);

  if (!sender) {
    const error = new Error("Sender not found");
    error.statusCode = 404;
    throw error;
  }

  if (!receiver) {
    const error = new Error("Receiver not found");
    error.statusCode = 404;
    throw error;
  }

  const message = await Message.create({
    sender: normalizedSenderId,
    receiver: normalizedReceiverId,
    text: normalizedText
  });
  const populated = await Message.findById(message._id).populate("sender receiver", "username email");
  return serializeMessage(populated);
};

export const getOnlineUsers = async (_req, res) => {
  try {
    const users = await User.find({ isLoggedIn: true }).select("username email").sort({ username: 1 });
    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const getMessages = async (_req, res) => {
  try {
    const userId = normalizeValue(_req.query.userId);
    const chatWith = normalizeValue(_req.query.chatWith);

    if (!userId || !chatWith) {
      return res.status(400).json({ message: "userId and chatWith are required" });
    }

    const messages = await Message.find()
      .where({
        $or: [
          { sender: userId, receiver: chatWith },
          { sender: chatWith, receiver: userId }
        ]
      })
      .populate("sender receiver", "username email")
      .sort({ createdAt: 1 })
      .limit(200);

    return res.status(200).json({ messages: messages.map(serializeMessage) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const populatedMessage = await createChatMessage(req.body.senderId, req.body.receiverId, req.body.text);

    emitSocketEvent("message:new", { message: populatedMessage });

    return res.status(201).json({ message: "Message sent", data: populatedMessage });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || "Server error" });
  }
};

export const deleteAllMessages = async (_req, res) => {
  try {
    await Message.deleteMany({});
    emitSocketEvent("messages:cleared", { ok: true });
    return res.status(200).json({ message: "All messages deleted" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Server error" });
  }
};
