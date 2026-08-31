import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const matrixRoot = join(root, 'examples', 'bot-matrix');
const families = [
  ['message-responder', 'track', 'MESSAGE_CREATE', 'message'],
  ['channel-manager', 'auto', 'CHANNEL_UPDATE', 'channel'],
  ['role-manager', 'auto', 'ROLE_UPDATE', 'role'],
  ['member-moderator', 'auto', 'MEMBER_KICK', 'user'],
  ['ban-moderator', 'auto', 'MEMBER_BAN_ADD', 'user'],
  ['invite-helper', 'auto', 'INVITE_CREATE', 'invite'],
  ['event-coordinator', 'auto', 'GUILD_SCHEDULED_EVENT_UPDATE', 'scheduled-event'],
  ['automod-manager', 'auto', 'AUTO_MODERATION_RULE_UPDATE', 'auto-moderation-rule'],
  ['thread-support', 'auto', 'THREAD_CREATE', 'thread'],
  ['permission-manager', 'auto', 'CHANNEL_OVERWRITE_UPDATE', 'overwrite'],
];
const shapes = ['minimal', 'environment-configured', 'prefix-command', 'slash-command', 'worker-process'];
const profile = (language, number, family, shape, integration, actionType, targetType) => ({ id: `${language}-${String(number).padStart(2, '0')}-${family}-${shape}`, language, family, shape, integration: language === 'python' && integration === 'auto' ? 'intent' : integration, actionType, targetType });
const jsSource = value => `import { Client, GatewayIntentBits } from 'discord.js';
import { attach } from '../../../parity-js/src/index.js';

export const profile = Object.freeze(${JSON.stringify(value)});

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
`;
const pySource = value => `import asyncio
import sys
from pathlib import Path

import discord

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'parity-py'))

from parity_py import attach

PROFILE = ${JSON.stringify(value, null, 2)}

def create_baseline_bot():
    intents = discord.Intents.none()
    intents.guilds = True
    intents.moderation = True
    intents.guild_messages = True
    return discord.Client(intents=intents)

async def create_parity_bot(**options):
    client = create_baseline_bot()
    parity = await attach(client, runtime=False, **options)
    return {'client': client, 'parity': parity, 'profile': PROFILE}

async def run_action(context, parity=None):
    if parity is None:
        return await context['perform']()
    if PROFILE['integration'] == 'track':
        return await parity['track'](context['intent_for'], context['perform'])
    await parity['intent']({'actionType': PROFILE['actionType'], 'targetId': str(context['targetId']), 'targetType': PROFILE['targetType'], 'guildId': str(context['guildId'])})
    return await context['perform']()

async def start_bot(token, **options):
    bot = await create_parity_bot(**options)
    await bot['client'].start(token)
    return bot
`;

rmSync(matrixRoot, { recursive: true, force: true });
mkdirSync(join(matrixRoot, 'javascript'), { recursive: true });
mkdirSync(join(matrixRoot, 'python'), { recursive: true });
const catalog = [];
for (const language of ['javascript', 'python']) {
  let number = 1;
  for (const [family, integration, actionType, targetType] of families) {
    for (const shape of shapes) {
      const value = profile(language, number, family, shape, integration, actionType, targetType);
      catalog.push(value);
      const name = `${String(number).padStart(2, '0')}-${family}-${shape}`;
      writeFileSync(join(matrixRoot, language, `${name}.${language === 'javascript' ? 'mjs' : 'py'}`), language === 'javascript' ? jsSource(value) : pySource(value), 'utf8');
      number += 1;
    }
  }
}
writeFileSync(join(matrixRoot, 'catalog.json'), `${JSON.stringify({ schemaVersion: '1.0', variants: catalog }, null, 2)}\n`, 'utf8');
writeFileSync(join(matrixRoot, 'README.md'), `# Bot matrix examples\n\nThis catalog contains 100 copyable integration starting points: 50 JavaScript and 50 Python. Each combines one of ten meaningful Discord bot families with one of five deployment shapes.\n\nEvery example exports or defines a baseline bot without Parity, a Parity-enabled bot, and a single action boundary. JavaScript auto-wrap variants use \`autoWrap: true\`; Python variants record target-known actions explicitly; message responders use result-derived tracking in both runtimes.\n\nRun \`node tools/generate-bot-matrix.mjs\` after changing the catalog generator. Run \`npm run test:bot-matrix\` to execute every baseline and Parity action boundary.\n`, 'utf8');
console.log(`Generated ${catalog.length} bot variants.`);
