import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    text: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [500, "Message cannot exceed 500 characters"]
    }
  },
  {
    timestamps: true
  }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;
