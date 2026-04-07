import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

const createToken = (userId) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is missing in .env");
  }

  return jwt.sign({ id: userId }, secret, { expiresIn: "7d" });
};

const normalizeValue = (value) => (typeof value === "string" ? value.trim() : "");

export const registerUser = async (req, res) => {
  try {
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
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error("registerUser error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const login = normalizeValue(req.body.login); // username or email
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
    await user.save();

    const token = createToken(user._id);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error("loginUser error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

export const logoutUser = async (req, res) => {
  try {
    const userId = normalizeValue(req.body.userId);

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    await User.findByIdAndUpdate(userId, { isLoggedIn: false });
    return res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    console.error("logoutUser error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};
