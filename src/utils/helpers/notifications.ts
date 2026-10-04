import prisma from "@/utils/prisma";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import fs from "fs";
import path from "path";

// Initialize Firebase Admin SDK if not already initialized
const apps = getApps();
if (!apps.length) {
  try {
    const serviceAccountPath = path.resolve(process.cwd(), ".secrets/firebase_config.json");
    
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
      initializeApp({
        credential: cert(serviceAccount),
      });
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({
        credential: cert(
          JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
        ),
      });
    } else {
      console.warn(
        "Firebase credentials not found (.secrets/firebase_config.json or FIREBASE_SERVICE_ACCOUNT_KEY environment variable). Push notifications will be mocked.",
      );
    }
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
  }
}

export type NotificationType = "MESSAGE" | "MATCH" | "REQUEST";

export const sendNotification = async (
  userId: string,
  title: string,
  body: string,
  type: NotificationType = "MESSAGE",
) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fcmToken: true,
        pushNewMessages: true,
        pushNewMatches: true,
        pushRequests: true,
      },
    });

    if (!user || !user.fcmToken) {
      console.log(
        `[Notification to User ${userId}] ${title}: ${body} (No FCM Token)`,
      );
      return;
    }

    // Check user preferences
    if (type === "MESSAGE" && !user.pushNewMessages) return;
    if (type === "MATCH" && !user.pushNewMatches) return;
    if (type === "REQUEST" && !user.pushRequests) return;

    const currentApps = getApps();
    if (!currentApps.length) {
      console.log(
        `[Mock Push Notification to User ${userId}] ${title}: ${body}`,
      );
      return;
    }

    const message = {
      notification: { title, body },
      token: user.fcmToken,
      data: { type },
    };

    const response = await getMessaging().send(message);
    console.log(`Successfully sent message to ${userId}:`, response);
  } catch (error) {
    console.error(`Error sending push notification to user ${userId}:`, error);
  }
};
