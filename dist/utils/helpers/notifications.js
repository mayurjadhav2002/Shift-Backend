"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotification = void 0;
const prisma_1 = __importDefault(require("../../utils/prisma"));
const app_1 = require("firebase-admin/app");
const messaging_1 = require("firebase-admin/messaging");
// Initialize Firebase Admin SDK if not already initialized
const apps = (0, app_1.getApps)();
if (!apps.length) {
    try {
        // In production, you would use a service account key file or environment variables
        // For now, we will just stub it if credentials are not provided
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            (0, app_1.initializeApp)({
                credential: (0, app_1.cert)(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
            });
        }
        else {
            console.warn("FIREBASE_SERVICE_ACCOUNT_KEY is not set. Push notifications will be mocked.");
        }
    }
    catch (error) {
        console.error("Failed to initialize Firebase Admin:", error);
    }
}
const sendNotification = async (userId, title, body, type = "MESSAGE") => {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                fcmToken: true,
                pushNewMessages: true,
                pushNewMatches: true,
                pushRequests: true,
            },
        });
        if (!user || !user.fcmToken) {
            console.log(`[Notification to User ${userId}] ${title}: ${body} (No FCM Token)`);
            return;
        }
        // Check user preferences
        if (type === "MESSAGE" && !user.pushNewMessages)
            return;
        if (type === "MATCH" && !user.pushNewMatches)
            return;
        if (type === "REQUEST" && !user.pushRequests)
            return;
        const currentApps = (0, app_1.getApps)();
        if (!currentApps.length) {
            console.log(`[Mock Push Notification to User ${userId}] ${title}: ${body}`);
            return;
        }
        const message = {
            notification: { title, body },
            token: user.fcmToken,
            data: { type },
        };
        const response = await (0, messaging_1.getMessaging)().send(message);
        console.log(`Successfully sent message to ${userId}:`, response);
    }
    catch (error) {
        console.error(`Error sending push notification to user ${userId}:`, error);
    }
};
exports.sendNotification = sendNotification;
