type SlackEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  [key: string]: unknown;
};

export function shouldHandleAppMention(event: SlackEvent): boolean {
  return event.type === "app_mention" && !event.subtype && !event.bot_id;
}
