import { createId, getDatabase, nowIso } from "@/lib/db";
import { openSecret } from "@/lib/secrets";
import type { DiscordEmbedPayload, ListingRecord } from "@/lib/types";

export function buildDiscordPayload(input: {
  title: string;
  message: string;
  listing?: ListingRecord;
}): DiscordEmbedPayload {
  const fields = input.listing
    ? [
        {
          name: "Retailer",
          value: input.listing.retailer,
          inline: true,
        },
        {
          name: "Availability",
          value: input.listing.current_availability.replaceAll("_", " "),
          inline: true,
        },
        {
          name: "Price",
          value:
            input.listing.current_price_cents === null
              ? "Unknown"
              : `$${(input.listing.current_price_cents / 100).toFixed(2)}`,
          inline: true,
        },
      ]
    : [];

  return {
    username: "DealHunter",
    embeds: [
      {
        title: input.title,
        description: input.message,
        url: input.listing?.url,
        color: 0xf2a93b,
        fields,
        footer: { text: "DealHunter alert" },
        timestamp: nowIso(),
      },
    ],
  };
}

function validateWebhookUrl(value: string) {
  const url = new URL(value);
  const discordHosts = new Set([
    "discord.com",
    "canary.discord.com",
    "ptb.discord.com",
    "discordapp.com",
  ]);
  const localAllowed =
    process.env.DEALHUNTER_ALLOW_LOCAL_WEBHOOKS === "1" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localAllowed) {
    throw new Error("Discord webhook URLs must use HTTPS.");
  }
  if (!discordHosts.has(url.hostname) && !localAllowed) {
    throw new Error("Only Discord webhook hosts are allowed.");
  }
  return url;
}

export function assertAllowedDiscordWebhook(value: string) {
  validateWebhookUrl(value);
}

async function deliver(
  channelId: string,
  payload: DiscordEmbedPayload,
  alertId?: string,
) {
  const database = getDatabase();
  const channel = database
    .prepare(
      `SELECT id, secret_value
       FROM notification_channels
       WHERE id = ? AND type = 'DISCORD' AND enabled = 1`,
    )
    .get(channelId) as { id: string; secret_value: string } | undefined;
  if (!channel) return;

  let status = "DELIVERED";
  let responseCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const webhook = validateWebhookUrl(openSecret(channel.secret_value));
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    responseCode = response.status;
    if (!response.ok) {
      status = response.status === 429 ? "RATE_LIMITED" : "FAILED";
      errorMessage = `Discord returned HTTP ${response.status}.`;
    }
  } catch (error) {
    status = "FAILED";
    errorMessage = error instanceof Error ? error.message : "Delivery failed.";
  }

  database
    .prepare(
      `INSERT INTO notification_deliveries
       (id, alert_id, channel_id, status, response_code, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      createId(),
      alertId ?? null,
      channelId,
      status,
      responseCode,
      errorMessage,
      nowIso(),
    );
}

export async function deliverAlertToDiscord(
  projectId: string,
  alertId: string,
  payload: DiscordEmbedPayload,
) {
  const channels = getDatabase()
    .prepare(
      `SELECT c.id
       FROM notification_channels c
       JOIN project_notification_channels pc ON pc.channel_id = c.id
       WHERE pc.project_id = ?
         AND c.type = 'DISCORD'
         AND c.enabled = 1`,
    )
    .all(projectId) as Array<{ id: string }>;
  await Promise.all(
    channels.map((channel) => deliver(channel.id, payload, alertId)),
  );
}

export async function sendDiscordTest(channelId: string) {
  await deliver(
    channelId,
    buildDiscordPayload({
      title: "DealHunter connection verified",
      message:
        "Discord notifications are configured. Future qualifying deals will appear here.",
    }),
  );
}
