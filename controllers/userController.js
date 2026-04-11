import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { isDatabaseConnected } from "../config/db.js";

let ioInstance = null;

const createToken = (userId) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is missing in .env");
  }

  return jwt.sign({ id: userId }, secret, { expiresIn: "7d" });
};

const normalizeValue = (value) => (typeof value === "string" ? value.trim() : "");
const toId = (value) => String(value);

const ensureDatabase = (res) => {
  if (!isDatabaseConnected()) {
    res.status(503).json({ message: "Database is not connected yet. Please try again shortly." });
    return false;
  }

  return true;
};

const serializeAuthUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email
});

export const setUserSocketIO = (io) => {
  ioInstance = io;
};

const emitNetworkRefresh = (...userIds) => {
  if (!ioInstance) {
    return;
  }

  const uniqueIds = [...new Set(userIds.map(toId).filter(Boolean))];

  if (!uniqueIds.length) {
    ioInstance.emit("network:refresh", { scope: "global" });
    return;
  }

  uniqueIds.forEach((userId) => {
    ioInstance.to(`user:${userId}`).emit("network:refresh", { scope: "user", userId });
  });
};

const relationForUser = (currentUser, otherUserId) => {
  const targetId = toId(otherUserId);
  const friends = new Set((currentUser.friends || []).map(toId));
  const incoming = new Set((currentUser.incomingFriendRequests || []).map(toId));
  const outgoing = new Set((currentUser.outgoingFriendRequests || []).map(toId));

  if (friends.has(targetId)) return "friend";
  if (incoming.has(targetId)) return "incoming";
  if (outgoing.has(targetId)) return "outgoing";
  return "none";
};

const serializeRelationshipUser = (currentUser, user) => {
  const relation = relationForUser(currentUser, user._id);

  return {
    _id: toId(user._id),
    username: user.username,
    email: user.email,
    isLoggedIn: Boolean(user.isLoggedIn),
    friendCount: Array.isArray(user.friends) ? user.friends.length : 0,
    relation,
    canMessage: relation === "friend"
  };
};

const findUserOr404 = async (userId, res) => {
  const normalizedUserId = normalizeValue(userId);

  if (!normalizedUserId) {
    res.status(400).json({ message: "userId is required" });
    return null;
  }

  const user = await User.findById(normalizedUserId);

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return null;
  }

  return user;
};

export const registerUser = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const username = normalizeValue(req.body.username);
    const email = normalizeValue(req.body.email).toLowerCase();
    const password = normalizeValue(req.body.password);

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.status(409).json({ message: "Username or email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashedPassword });
    const token = createToken(user._id);

    return res.status(201).json({
      message: "User registered successfully",
      token,
      user: serializeAuthUser(user)
    });
  } catch (error) {
    console.error("registerUser error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const loginUser = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const login = normalizeValue(req.body.login);
    const password = normalizeValue(req.body.password);

    if (!login || !password) {
      return res.status(400).json({ message: "login and password are required" });
    }

    const isEmail = login.includes("@");
    const query = isEmail ? { email: login.toLowerCase() } : { username: login };
    const user = await User.findOne(query);

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    user.isLoggedIn = true;
    user.lastActiveAt = new Date();
    await user.save();

    emitNetworkRefresh();

    const token = createToken(user._id);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: serializeAuthUser(user)
    });
  } catch (error) {
    console.error("loginUser error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const logoutUser = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const user = await findUserOr404(req.body.userId, res);
    if (!user) return;

    user.isLoggedIn = false;
    user.lastActiveAt = new Date();
    await user.save();

    emitNetworkRefresh();

    return res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    console.error("logoutUser error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const getNetworkData = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const currentUser = await findUserOr404(req.query.userId, res);
    if (!currentUser) return;

    const onlineUsers = await User.find({
      _id: { $ne: currentUser._id },
      isLoggedIn: true
    }).select("username email isLoggedIn friends").sort({ username: 1 });

    const incomingRequests = await User.find({
      _id: { $in: currentUser.incomingFriendRequests || [] }
    }).select("username email isLoggedIn friends").sort({ username: 1 });

    const outgoingRequests = await User.find({
      _id: { $in: currentUser.outgoingFriendRequests || [] }
    }).select("username email isLoggedIn friends").sort({ username: 1 });

    const friends = await User.find({
      _id: { $in: currentUser.friends || [] }
    }).select("username email isLoggedIn friends").sort({ username: 1 });

    return res.status(200).json({
      friendCount: (currentUser.friends || []).length,
      friends: friends.map((user) => serializeRelationshipUser(currentUser, user)),
      incomingRequests: incomingRequests.map((user) => serializeRelationshipUser(currentUser, user)),
      outgoingRequests: outgoingRequests.map((user) => serializeRelationshipUser(currentUser, user)),
      onlineUsers: onlineUsers.map((user) => serializeRelationshipUser(currentUser, user))
    });
  } catch (error) {
    console.error("getNetworkData error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const sendFriendRequest = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const currentUser = await findUserOr404(req.body.userId, res);
    if (!currentUser) return;

    const targetUser = await findUserOr404(req.body.targetUserId, res);
    if (!targetUser) return;

    if (toId(currentUser._id) === toId(targetUser._id)) {
      return res.status(400).json({ message: "You cannot add yourself as a friend" });
    }

    const relation = relationForUser(currentUser, targetUser._id);

    if (relation === "friend") {
      return res.status(409).json({ message: "You are already friends" });
    }

    if (relation === "outgoing") {
      return res.status(409).json({ message: "Friend request already sent" });
    }

    if (relation === "incoming") {
      return res.status(409).json({ message: "This user already sent you a friend request" });
    }

    currentUser.outgoingFriendRequests.push(targetUser._id);
    targetUser.incomingFriendRequests.push(currentUser._id);

    await Promise.all([currentUser.save(), targetUser.save()]);
    emitNetworkRefresh(currentUser._id, targetUser._id);

    return res.status(200).json({ message: "Friend request sent" });
  } catch (error) {
    console.error("sendFriendRequest error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const cancelFriendRequest = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const currentUser = await findUserOr404(req.body.userId, res);
    if (!currentUser) return;

    const targetUser = await findUserOr404(req.body.targetUserId, res);
    if (!targetUser) return;

    const targetUserId = toId(targetUser._id);
    const currentUserId = toId(currentUser._id);
    const hasOutgoing = (currentUser.outgoingFriendRequests || []).some((id) => toId(id) === targetUserId);

    if (!hasOutgoing) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    currentUser.outgoingFriendRequests = (currentUser.outgoingFriendRequests || []).filter((id) => toId(id) !== targetUserId);
    targetUser.incomingFriendRequests = (targetUser.incomingFriendRequests || []).filter((id) => toId(id) !== currentUserId);

    await Promise.all([currentUser.save(), targetUser.save()]);
    emitNetworkRefresh(currentUser._id, targetUser._id);

    return res.status(200).json({ message: "Friend request canceled" });
  } catch (error) {
    console.error("cancelFriendRequest error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const respondToFriendRequest = async (req, res) => {
  try {
    if (!ensureDatabase(res)) return;

    const currentUser = await findUserOr404(req.body.userId, res);
    if (!currentUser) return;

    const requestUser = await findUserOr404(req.body.requestUserId, res);
    if (!requestUser) return;

    const action = normalizeValue(req.body.action).toLowerCase();

    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ message: "action must be accept or reject" });
    }

    const requestUserId = toId(requestUser._id);
    const currentUserId = toId(currentUser._id);
    const hasIncoming = (currentUser.incomingFriendRequests || []).some((id) => toId(id) === requestUserId);

    if (!hasIncoming) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    currentUser.incomingFriendRequests = (currentUser.incomingFriendRequests || []).filter((id) => toId(id) !== requestUserId);
    requestUser.outgoingFriendRequests = (requestUser.outgoingFriendRequests || []).filter((id) => toId(id) !== currentUserId);

    if (action === "accept") {
      if (!(currentUser.friends || []).some((id) => toId(id) === requestUserId)) {
        currentUser.friends.push(requestUser._id);
      }

      if (!(requestUser.friends || []).some((id) => toId(id) === currentUserId)) {
        requestUser.friends.push(currentUser._id);
      }
    }

    await Promise.all([currentUser.save(), requestUser.save()]);
    emitNetworkRefresh(currentUser._id, requestUser._id);

    return res.status(200).json({
      message: action === "accept" ? "Friend request accepted" : "Friend request rejected"
    });
  } catch (error) {
    console.error("respondToFriendRequest error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};
