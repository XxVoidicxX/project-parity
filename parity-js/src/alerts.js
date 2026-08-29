export class AlertDispatcher { constructor(strategies = []) { this.strategies = strategies; } async dispatch(report) { await Promise.all(this.strategies.map(strategy => strategy.send(report))); } }
export class WebhookAlertStrategy { constructor(url, fetcher = fetch) { this.url = url; this.fetcher = fetcher; } async send(report) { const response = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) }); if (!response.ok) throw new Error(`Parity webhook failed: ${response.status}`); } }
export class DirectMessageAlertStrategy { constructor(user) { this.user = user; } async send(report) { await this.user.send({ content: JSON.stringify(report) }); } }
export function formatDriftAlert(report, mentionUserId = null) {
  const event = report.event;
  const prefix = mentionUserId == null ? '' : `<@${String(mentionUserId)}> `;
  const action = report.suggestedRemediation?.[0] ?? 'Review this bot process and Discord audit log immediately.';
  return `${prefix}Parity detected an action this bot process did not plan. The token may be in use elsewhere.\nAction: ${event.actionType}\nTarget: ${event.targetId}\nGuild: ${event.guildId}\nTime: ${event.occurredAt}\nConfidence: ${report.confidence}\nDo now: ${action}`.slice(0, 2000);
}
export class DiscordChannelAlertStrategy {
  constructor({ client, channelId, mentionUserId = null, sendMessage = null } = {}) {
    if (!client) throw new Error('DiscordChannelAlertStrategy requires a Discord client');
    if (channelId == null || String(channelId).trim() === '') throw new Error('DiscordChannelAlertStrategy requires an alert channel ID');
    this.client = client;
    this.channelId = String(channelId);
    this.mentionUserId = mentionUserId == null ? null : String(mentionUserId);
    this.sendMessage = sendMessage;
  }
  async send(report) {
    const channel = this.client.channels?.cache?.get(this.channelId) ?? await this.client.channels?.fetch?.(this.channelId);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') throw new Error('Parity alert channel must be a text channel');
    const content = formatDriftAlert(report, this.mentionUserId);
    if (this.sendMessage) return this.sendMessage(channel, content);
    return channel.send({ content });
  }
}
