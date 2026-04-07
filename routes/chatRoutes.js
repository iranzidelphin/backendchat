import express from "express";
import {
  deleteAllMessages,
  getMessages,
  getOnlineUsers,
  sendMessage
} from "../controllers/chatController.js";

const router = express.Router();

router.get("/online-users", getOnlineUsers);
router.get("/messages", getMessages);
router.post("/messages", sendMessage);
router.delete("/messages", deleteAllMessages);

export default router;
