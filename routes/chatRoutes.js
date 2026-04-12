import express from "express";
import {
  deleteMessage,
  getMessages,
  getOnlineUsers,
  sendMessage,
  updateMessage
} from "../controllers/chatController.js";

const router = express.Router();

router.get("/online-users", getOnlineUsers);
router.get("/messages", getMessages);
router.post("/messages", sendMessage);
router.patch("/messages/:messageId", updateMessage);
router.delete("/messages/:messageId", deleteMessage);

export default router;
