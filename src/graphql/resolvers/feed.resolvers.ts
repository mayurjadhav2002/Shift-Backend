import prisma from "@/utils/prisma";
import { MyContext } from "@/middleware/auth";

export const feedResolvers = {
  Query: {
    getFeed: async (
      _: any,
      args: { limit?: number; offset?: number },
      context: MyContext,
    ) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: context.userId },
      });

      const swipedUsers = await prisma.swipe.findMany({
        where: { swiperId: context.userId },
        select: { swipedId: true },
      });

      const blockedRecords = await prisma.blockedUser.findMany({
        where: {
          OR: [{ blockerId: context.userId }, { blockedId: context.userId }],
        },
      });

      const swipedUserIds = swipedUsers.map((s) => s.swipedId);
      const blockedUserIds = blockedRecords.map((b) =>
        b.blockerId === context.userId ? b.blockedId : b.blockerId
      );
      const excludedIds = [...new Set([...swipedUserIds, ...blockedUserIds, context.userId])];

      const whereClause: any = {
        id: { notIn: excludedIds },
        isPaused: false,
      };

      if (currentUser?.isPremium && currentUser?.preferredCountry && currentUser.preferredCountry !== "All") {
        whereClause.country = currentUser.preferredCountry;
      }

      const users = await prisma.user.findMany({
        where: whereClause,
        take: args.limit || 20,
        skip: args.offset || 0,
      });

      return users;
    },
    getRequests: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      // Find all incoming likes/superlikes
      const incomingSwipes = await prisma.swipe.findMany({
        where: {
          swipedId: context.userId,
          type: { in: ["LIKE", "SUPERLIKE"] },
        },
        orderBy: {
          // Prisma doesn't support custom sort order easily, so we sort in JS
          createdAt: 'desc'
        }
      });

      if (incomingSwipes.length === 0) return [];

      const swiperIds = incomingSwipes.map((s) => s.swiperId);

      // Find existing matches to filter out
      const matches = await prisma.match.findMany({
        where: {
          OR: [{ user1Id: context.userId }, { user2Id: context.userId }],
        },
      });

      const matchedUserIds = matches.map((m) =>
        m.user1Id === context.userId ? m.user2Id : m.user1Id
      );

      // We only want users we haven't matched with yet
      // Also we shouldn't have swiped them yet (if we swiped them left, they shouldn't be here)
      // Actually, if we swiped them left (DISLIKE), should they be in requests? Yes, wait no. If we disliked them, we probably shouldn't see their request again.
      const mySwipes = await prisma.swipe.findMany({
        where: { swiperId: context.userId },
      });
      const swipedUserIds = mySwipes.map((s) => s.swipedId);
      
      const blockedRecords = await prisma.blockedUser.findMany({
        where: {
          OR: [{ blockerId: context.userId }, { blockedId: context.userId }],
        },
      });
      const blockedUserIds = blockedRecords.map((b) =>
        b.blockerId === context.userId ? b.blockedId : b.blockerId
      );

      const excludeIds = new Set([...matchedUserIds, ...swipedUserIds, ...blockedUserIds]);

      const validIncomingSwipes = incomingSwipes.filter((s) => !excludeIds.has(s.swiperId));
      
      if (validIncomingSwipes.length === 0) return [];

      // Sort by SUPERLIKE first
      validIncomingSwipes.sort((a, b) => {
        if (a.type === "SUPERLIKE" && b.type !== "SUPERLIKE") return -1;
        if (b.type === "SUPERLIKE" && a.type !== "SUPERLIKE") return 1;
        return 0;
      });

      const validSwiperIds = validIncomingSwipes.map((s) => s.swiperId);

      const users = await prisma.user.findMany({
        where: {
          id: { in: validSwiperIds },
          isPaused: false,
        },
      });

      // Maintain sorted order
      const usersMap = new Map(users.map((u) => [u.id, u]));
      return validSwiperIds.map((id) => usersMap.get(id)).filter(Boolean);
    },
    getPendingRequestsCount: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      // Find all incoming likes/superlikes
      const incomingSwipes = await prisma.swipe.findMany({
        where: {
          swipedId: context.userId,
          type: { in: ["LIKE", "SUPERLIKE"] },
        },
        select: { swiperId: true }
      });

      if (incomingSwipes.length === 0) return 0;

      // Find existing matches to filter out
      const matches = await prisma.match.findMany({
        where: {
          OR: [{ user1Id: context.userId }, { user2Id: context.userId }],
        },
      });

      const matchedUserIds = matches.map((m) =>
        m.user1Id === context.userId ? m.user2Id : m.user1Id
      );

      // We only want users we haven't matched with yet
      // Also we shouldn't have swiped them yet
      const mySwipes = await prisma.swipe.findMany({
        where: { swiperId: context.userId },
        select: { swipedId: true }
      });
      const swipedUserIds = mySwipes.map((s) => s.swipedId);
      
      const excludeIds = new Set([...matchedUserIds, ...swipedUserIds]);
      const count = incomingSwipes.filter((s) => !excludeIds.has(s.swiperId)).length;
      
      return count;
    },
  },
};
