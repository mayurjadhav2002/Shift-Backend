import prisma from "@/utils/prisma";
import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps?.length) {
  try {
    // In production, you would use a service account key file or environment variables
    // For now, we will just stub it if credentials are not provided
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert(
          JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
        ),
      });
    } else {
      console.warn(
        "FIREBASE_SERVICE_ACCOUNT_KEY is not set. Push notifications will be mocked.",
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

    if (!admin.apps.length) {
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

    const response = await admin.messaging().send(message);
    console.log(`Successfully sent message to ${userId}:`, response);
  } catch (error) {
    console.error(`Error sending push notification to user ${userId}:`, error);
  }
};
