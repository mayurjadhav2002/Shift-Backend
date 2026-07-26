export const sendNotification = async (
  userId: string,
  title: string,
  body: string
) => {
  // TODO: Implement actual push notification logic (e.g., using Firebase Cloud Messaging)
  console.log(`[Notification to User ${userId}] ${title}: ${body}`);
};
