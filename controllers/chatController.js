import Message from "../models/Message.js";
import User from "../models/User.js";
import { isDatabaseConnected } from "../config/db.js";

const normalizeValue = (value) => (typeof value === "string" ? value.trim() : "");
let ioInstance = null;
const toId = (value) => String(value);

const serializeUser = (userValue) => {
  if (!userValue) {
    return null;
  }

  // Populated user document/object
  if (typeof userValue === "object" && userValue._id) {
    return {
      _id: String(userValue._id),
      username: userValue.username,
      email: userValue.email,
      isLoggedIn: Boolean(userValue.isLoggedIn)
    };
  }

  // Fallback: raw ObjectId/string
  return { _id: String(userValue) };
};

const serializeMessage = (messageValue) => {
  const message = typeof messageValue?.toObject === "function" ? messageValue.toObject() : messageValue;
  const replyTo = message.replyTo && typeof message.replyTo === "object"
    ? {
        _id: String(message.replyTo._id),
        text: message.replyTo.text,
        sender: serializeUser(message.replyTo.sender)
      }
    : null;

  return {
    _id: String(message._id),
    sender: serializeUser(message.sender),
    receiver: serializeUser(message.receiver),
    text: message.text,
    replyTo,
    editedAt: message.editedAt || null,
    createdAt: message.createdAt
  };
};

export const setSocketIO = (io) => {
  ioInstance = io;
};

const ensureConversationFriendship = async (userId, chatWith) => {
  const user = await User.findById(userId).select("friends");
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  const isFriend = (user.friends || []).some((friendId) => toId(friendId) === chatWith);
  if (!isFriend) {
    const error = new Error("Only friends can access this conversation");
    error.statusCode = 403;
    throw error;
  }

  return user;
};

const populateMessage = async (messageId) =>
  Message.findById(messageId)
    .populate("sender receiver", "username email isLoggedIn")
    .populate({
      path: "replyTo",
      populate: { path: "sender", select: "username email isLoggedIn" },
      select: "text sender"
    });

const emitSocketEvent = (eventName, payload) => {
  if (ioInstance) {
    ioInstance.emit(eventName, payload);
  }
};

const emitSocketEventToUser = (userId, eventName, payload) => {
  if (!ioInstance || !userId) {
    return;
  }

  ioInstance.to(`user:${toId(userId)}`).emit(eventName, payload);
};

export const markConversationRead = async (userId, chatWith) => {
  const normalizedUserId = normalizeValue(userId);
  const normalizedChatWith = normalizeValue(chatWith);

  if (!normalizedUserId || !normalizedChatWith) {
    return 0;
  }

  const result = await Message.updateMany(
    {
      sender: normalizedChatWith,
      receiver: normalizedUserId,
      readByReceiver: false
    },
    {
      $set: { readByReceiver: true }
    }
  );

  emitSocketEventToUser(normalizedUserId, "messages:read", {
    userId: normalizedUserId,
    chatWith: normalizedChatWith
  });

  return result.modifiedCount || 0;
};

export const createChatMessage = async (senderId, receiverId, text, replyToId = "") => {
  if (!isDatabaseConnected()) {
    const error = new Error("Database is not connected yet. Please try again in a moment.");
    error.statusCode = 503;
    throw error;
  }

  const normalizedSenderId = normalizeValue(senderId);
  const normalizedReceiverId = normalizeValue(receiverId);
  const normalizedText = normalizeValue(text);
  const normalizedReplyToId = normalizeValue(replyToId);

  if (!normalizedSenderId || !normalizedReceiverId || !normalizedText) {
    const error = new Error("senderId, receiverId and text are required");
    error.statusCode = 400;
    throw error;
  }

  const [sender, receiver] = await Promise.all([
    User.findById(normalizedSenderId).select("friends"),
    User.findById(normalizedReceiverId).select("friends")
  ]);

  if (!sender || !receiver) {
    const error = new Error("Users not found");
    error.statusCode = 404;
    throw error;
  }

  const senderFriends = new Set((sender.friends || []).map(toId));
  const receiverFriends = new Set((receiver.friends || []).map(toId));

  if (!senderFriends.has(toId(receiver._id)) || !receiverFriends.has(toId(sender._id))) {
    const error = new Error("Only friends can send messages to each other");
    error.statusCode = 403;
    throw error;
  }

  if (normalizedReplyToId) {
    const replyMessage = await Message.findById(normalizedReplyToId).select("sender receiver");
    if (!replyMessage) {
      const error = new Error("Reply message not found");
      error.statusCode = 404;
      throw error;
    }

    const participants = new Set([
      toId(replyMessage.sender),
      toId(replyMessage.receiver)
    ]);
    if (!participants.has(normalizedSenderId) || !participants.has(normalizedReceiverId)) {
      const error = new Error("You can only reply within the same conversation");
      error.statusCode = 403;
      throw error;
    }
  }

  const message = await Message.create({
    sender: normalizedSenderId,
    receiver: normalizedReceiverId,
    text: normalizedText,
    replyTo: normalizedReplyToId || null,
    readByReceiver: false
  });

  const populated = await populateMessage(message._id);
  return serializeMessage(populated);
};

export const getOnlineUsers = async (_req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ message: "Database is not connected yet. Please try again shortly." });
    }

    const users = await User.find().select("username email isLoggedIn").sort({ username: 1 });
    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const getMessages = async (_req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ message: "Database is not connected yet. Please try again shortly." });
    }

    const userId = normalizeValue(_req.query.userId);
    const chatWith = normalizeValue(_req.query.chatWith);

    if (!userId || !chatWith) {
      return res.status(400).json({ message: "userId and chatWith are required" });
    }

    await ensureConversationFriendship(userId, chatWith);

    const messages = await Message.find()
      .where({
        $or: [
          { sender: userId, receiver: chatWith },
          { sender: chatWith, receiver: userId }
        ]
      })
      .populate("sender receiver", "username email isLoggedIn")
      .populate({
        path: "replyTo",
        populate: { path: "sender", select: "username email isLoggedIn" },
        select: "text sender"
      })
      .sort({ createdAt: 1 })
      .limit(200);

    await markConversationRead(userId, chatWith);

    return res.status(200).json({ messages: messages.map(serializeMessage) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const populatedMessage = await createChatMessage(req.body.senderId, req.body.receiverId, req.body.text, req.body.replyToId);

    emitSocketEvent("message:new", { message: populatedMessage });
    emitSocketEventToUser(populatedMessage.receiver?._id, "network:refresh", {
      scope: "user",
      userId: populatedMessage.receiver?._id
    });

    return res.status(201).json({ message: "Message sent", data: populatedMessage });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || "Server error" });
  }
};

export const updateMessage = async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ message: "Database is not connected yet. Please try again shortly." });
    }

    const messageId = normalizeValue(req.params.messageId);
    const userId = normalizeValue(req.body.userId);
    const text = normalizeValue(req.body.text);

    if (!messageId || !userId || !text) {
      return res.status(400).json({ message: "messageId, userId and text are required" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (toId(message.sender) !== userId) {
      return res.status(403).json({ message: "You can only edit your own messages" });
    }

    message.text = text;
    message.editedAt = new Date();
    await message.save();

    const populated = await populateMessage(message._id);
    const serialized = serializeMessage(populated);
    emitSocketEvent("message:updated", { message: serialized });

    return res.status(200).json({ message: "Message updated", data: serialized });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Server error" });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({ message: "Database is not connected yet. Please try again shortly." });
    }

    const messageId = normalizeValue(req.params.messageId);
    const userId = normalizeValue(req.query.userId || req.body.userId);

    if (!messageId || !userId) {
      return res.status(400).json({ message: "messageId and userId are required" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (toId(message.sender) !== userId) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    await Message.findByIdAndDelete(messageId);
    await Message.updateMany({ replyTo: message._id }, { $set: { replyTo: null } });
    emitSocketEvent("message:deleted", {
      messageId,
      senderId: toId(message.sender),
      receiverId: toId(message.receiver)
    });

    return res.status(200).json({ message: "Message deleted", messageId });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Server error" });
  }
};
