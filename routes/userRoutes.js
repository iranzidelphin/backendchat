import express from "express";
import {
  getNetworkData,
  loginUser,
  logoutUser,
  registerUser,
  respondToFriendRequest,
  sendFriendRequest
} from "../controllers/userController.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.get("/network", getNetworkData);
router.post("/friend-requests", sendFriendRequest);
router.post("/friend-requests/respond", respondToFriendRequest);

export default router;
