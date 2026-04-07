import mongoose from "mongoose";

export const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(mongoUri, {
    serverApi: {
      version: "1",
      strict: true,
      deprecationErrors: true
    }
  });

  console.log("MongoDB connected successfully.");
};
