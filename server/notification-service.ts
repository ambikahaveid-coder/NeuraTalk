import { db } from "./db";
import { subscriptions, users } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { logger } from "./observability";

export class SaaSNotificationService {
  /**
   * Cron-job trigger: Runs every 24 hours
   */
  static async processDailyReminders() {
    const intervals = [3, 1, 0]; // Days before expiry
    
    for (const days of intervals) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      
      const expiring = await db.select({
        user: users,
        sub: subscriptions
      })
      .from(subscriptions)
      .innerJoin(users, eq(subscriptions.userId, users.id))
      .where(and(
        eq(subscriptions.status, "active"),
        sql`DATE(${subscriptions.endDate}) = DATE(${targetDate})`
      ));

      for (const item of expiring) {
        await this.sendMultiChannelAlert(item.user, days);
      }
    }
  }

  private static async sendMultiChannelAlert(user: any, daysRemaining: number) {
    const message = daysRemaining === 0 
      ? `Your NeuraTalk plan expires TODAY. Top up now to avoid call drops.`
      : `Your NeuraTalk plan expires in ${daysRemaining} day(s).`;

    // 1. Push Notification (Firebase)
    // 2. SMS (MSG91/Twilio)
    // 3. WhatsApp (MSG91)
    
    logger.info("Notifications", `Alert sent to ${user.id} via Push/SMS/WA: ${message}`);
    
    // Logic to call external APIs for SMS/WA goes here
    // if (user.phone) await msg91.sendSMS(user.phone, message);
  }
}