import { Client, GatewayIntentBits } from 'discord.js';
import { attach } from '../../../parity-js/src/index.js';

export const profile = Object.freeze({"id":"javascript-41-thread-support-minimal","language":"javascript","family":"thread-support","shape":"minimal","integration":"auto","actionType":"THREAD_CREATE","targetType":"thread"});

export function createBaselineBot() {
  return new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages] });
}

export function createParityBot(options = {}) {
  const client = createBaselineBot();
  const parity = attach(client, { runtime: false, autoWrap: profile.integration === 'auto', ...options });
  return { client, parity, profile };
}

export async function runAction(context, parity = null) {
  if (parity == null || profile.integration === 'auto') return context.perform();
  if (profile.integration === 'track') return parity.track(context.intentFor, context.perform);
  await parity.intent({ actionType: profile.actionType, targetId: String(context.targetId), targetType: profile.targetType, guildId: String(context.guildId) });
  return context.perform();
}

export async function startBot(token, options = {}) {
  const bot = createParityBot(options);
  await bot.client.login(token);
  return bot;
}
