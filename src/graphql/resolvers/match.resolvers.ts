import prisma from "@/utils/prisma";
import { MyContext } from "@/middleware/auth";
import { SwipeType } from "@/generated/prisma/enums";
import { sendNotification } from "@/utils/helpers/notifications";

export const matchResolvers = {
  Query: {
    matches: async () => {
      return await prisma.match.findMany();
    },
    getUserMatches: async (
      _: any,
      args: { userId: string },
      context: MyContext,
    ) => {
      return await prisma.match.findMany({
        where: {
          OR: [{ user1Id: args.userId }, { user2Id: args.userId }],
        },
      });
    },
  },
  Mutation: {
    createMatch: async (
      _: any,
      args: { user2Id: string },
      context: MyContext,
    ) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      return await prisma.match.create({
        data: {
          user1Id: context.userId, // use JWT injected ID
          user2Id: args.user2Id,
        },
      });
    },
    unmatch: async (_: any, args: { id: string }, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      return await prisma.match.update({
        where: { id: args.id },
        data: {
          isUnmatched: true,
          unmatchedAt: new Date(),
        },
      });
    },
    swipe: async (_: any, args: { swipedId: string; type: string }, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      let tokenFieldToDeduct = "tokens";
      let cost = 0;

      if (args.type === "SUPERLIKE") {
        tokenFieldToDeduct = "superlikeTokens";
        cost = 1;
      } else if (args.type === "LIKE") {
        tokenFieldToDeduct = "tokens";
        cost = 10;
      }

      if (cost > 0) {
        const user = await prisma.user.findUnique({
          where: { id: context.userId },
          select: { tokens: true, superlikeTokens: true },
        });

        const currentBalance = tokenFieldToDeduct === "superlikeTokens" ? user?.superlikeTokens : user?.tokens;

        if (!user || currentBalance === undefined || currentBalance < cost) {
          throw new Error("Insufficient tokens");
        }

        // Deduct tokens
        await prisma.user.update({
          where: { id: context.userId },
          data: { [tokenFieldToDeduct]: { decrement: cost } },
        });
      }

      // Create Swipe
      const swipe = await prisma.swipe.create({
        data: {
          swiperId: context.userId,
          swipedId: args.swipedId,
          type: args.type as SwipeType,
        },
      });

      let match = null;

      // Check for mutual match
      if (args.type === "LIKE" || args.type === "SUPERLIKE") {
        const mutualSwipe = await prisma.swipe.findFirst({
          where: {
            swiperId: args.swipedId,
            swipedId: context.userId,
            type: { in: ["LIKE", "SUPERLIKE"] as SwipeType[] },
          },
        });

        if (mutualSwipe) {
          match = await prisma.match.create({
            data: {
              user1Id: context.userId,
              user2Id: args.swipedId,
            },
          });
          
          await sendNotification(context.userId, "New Match!", "You have a new match!");
          await sendNotification(args.swipedId, "New Match!", "You have a new match!");
        }
      }

      const updatedUser = await prisma.user.findUnique({
        where: { id: context.userId }
      });

      return {
        match,
        user: updatedUser
      };
    },
  },
};
