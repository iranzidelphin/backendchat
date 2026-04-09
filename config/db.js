import mongoose from "mongoose";

export const isDatabaseConnected = () => mongoose.connection.readyState === 1;

export const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    serverApi: {
      version: "1",
      strict: true,
      deprecationErrors: true
    }
  });

  console.log("MongoDB connected successfully.");
};

export const connectDBWithRetry = async () => {
  try {
    await connectDB();
  } catch (error) {
    console.error("MongoDB connection failed, retrying in 5 seconds:", error.message);

    setTimeout(() => {
      connectDBWithRetry().catch(() => {});
    }, 5000);
  }
};
