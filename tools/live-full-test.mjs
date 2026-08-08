/**
 * Comprehensive live integration test for Project Parity.
 *
 * Run:
 *   $env:DISCORD_BOT_TOKEN = 'your-token'
 *   $env:PARITY_GUILD_ID   = 'your-guild-id'
 *   node tools/live-full-test.mjs
 *
 * The test creates only its own temporary resources (channels, roles, webhooks)
 * and deletes them before exiting. No existing server resources are touched.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();
const TOKEN    = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.PARITY_GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.log('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run live tests.');
  process.exit(0);
}

const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = await import('discord.js');
const { attach } = await import('../parity-js/src/index.js');

const wait       = ms => new Promise(r => setTimeout(r, ms));
const ts         = () => Date.now().toString().slice(-6);
const results    = [];
const created    = { channels: [], roles: [], webhooks: [] };
const drifts     = [];
const rawShapes  = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail: detail ?? '' });
  const icon = pass ? '✓' : '✗';
  console.log(`  ${icon} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

async function waitDrift(match, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = drifts.find(match);
    if (hit) return hit;
    await wait(1000);
  }
  return null;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
  ],
});

client.on('guildAuditLogEntryCreate', (entry, guild) => {
  const shape = {
    action: entry.action,
    actionType: entry.actionType,
    targetType: entry.targetType,
    targetId: String(entry.targetId ?? entry.target?.id ?? ''),
    executorId: String(entry.executorId ?? entry.executor?.id ?? ''),
  };
  rawShapes.push(shape);
});

async function cleanup() {
  console.log('\n-- cleanup --');
  for (const wh of created.webhooks) {
    try { await wh.delete('parity live test cleanup'); console.log(`  deleted webhook ${wh.name}`); }
    catch (e) { console.log(`  webhook delete failed: ${e.message}`); }
  }
  for (const ch of created.channels) {
    try { await ch.delete('parity live test cleanup'); console.log(`  deleted channel ${ch.name}`); }
    catch (e) { console.log(`  channel delete failed: ${e.message}`); }
  }
  for (const role of created.roles) {
    try { await role.delete('parity live test cleanup'); console.log(`  deleted role ${role.name}`); }
    catch (e) { console.log(`  role delete failed: ${e.message}`); }
  }
  try { parity.detach(); } catch {}
  client.destroy();
}

let parity;

client.once('ready', async () => {
  try {
    console.log(`\nConnected as ${client.user.tag} (${client.user.id})`);
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();
    const me    = await guild.members.fetchMe();
    const flags = PermissionsBitField.Flags;
    const perms = {
      ViewAuditLog:    me.permissions.has(flags.ViewAuditLog),
      ManageChannels:  me.permissions.has(flags.ManageChannels),
      ManageRoles:     me.permissions.has(flags.ManageRoles),
      ManageWebhooks:  me.permissions.has(flags.ManageWebhooks),
      SendMessages:    me.permissions.has(flags.SendMessages),
    };
    console.log('Permissions:', JSON.stringify(perms));

    if (!perms.ViewAuditLog || !perms.ManageChannels) {
      record('required permissions', false, 'ViewAuditLog and ManageChannels are required');
      await cleanup(); printSummary(); process.exit(2);
    }
    record('required permissions', true, Object.entries(perms).map(([k, v]) => `${k}=${v}`).join(' '));

    parity = attach(client, { strategies: [{ send: async r => { drifts.push(r); } }] });

    // ---- SECTION 1: Channel tests (verifies 1.0.1 normalization fix) ----
    console.log('\n[1] Channel tests');

    const chA = await guild.channels.create({ name: `parity-test-${ts()}`, type: ChannelType.GuildText, topic: 'parity init', reason: 'parity live test' });
    created.channels.push(chA);
    console.log(`  created channel ${chA.name} (${chA.id})`);

    // 1a: Unrecorded update -> drift expected
    const beforeA = drifts.length;
    await chA.setTopic('rogue update');
    const rogueUpdate = await waitDrift(r => String(r.event.targetId) === String(chA.id) && r.event.actionType.includes('Update'));
    record('1a: unrecorded channel update is drift', !!rogueUpdate, rogueUpdate ? `actionType=${rogueUpdate.event.actionType}` : 'no drift in 25s');

    // 1b: 1.0.1 fix: naive intent shape (CHANNEL_UPDATE/channel) now reconciles (was FAIL pre-fix)
    const chB = await guild.channels.create({ name: `parity-test-${ts()}`, type: ChannelType.GuildText, topic: 'parity init', reason: 'parity live test' });
    created.channels.push(chB);
    await wait(3000);
    const beforeB = drifts.length;
    await parity.intent({ actionType: 'CHANNEL_UPDATE', targetId: String(chB.id), targetType: 'channel', guildId: GUILD_ID });
    await chB.setTopic('legit update - 1.0.1 naive shape');
    await wait(22000);
    const falseDrift = drifts.slice(beforeB).find(r => String(r.event.targetId) === String(chB.id) && r.event.actionType.includes('Update'));
    record('1b: 1.0.1 fix - naive intent shape reconciles', !falseDrift, falseDrift ? 'FALSE POSITIVE still present' : 'reconciled cleanly');

    // ---- SECTION 2: Role tests ----
    console.log('\n[2] Role tests');

    if (perms.ManageRoles) {
      const role = await guild.roles.create({ name: `parity-test-${ts()}`, reason: 'parity live test', permissions: [] });
      created.roles.push(role);
      console.log(`  created role ${role.name} (${role.id})`);

      // 2a: Rogue role update -> drift
      const beforeRole = drifts.length;
      await role.setName(`parity-test-${ts()}-updated`);
      const roleDrift = await waitDrift(r => String(r.event.targetId) === String(role.id));
      record('2a: unrecorded role update is drift', !!roleDrift, roleDrift ? `actionType=${roleDrift.event.actionType}` : 'no drift in 25s');

      // 2b: Recorded role update -> no drift
      const roleB = await guild.roles.create({ name: `parity-test-${ts()}`, reason: 'parity live test', permissions: [] });
      created.roles.push(roleB);
      await wait(3000);
      const beforeRoleB = drifts.length;
      await parity.intent({ actionType: 'ROLE_UPDATE', targetId: String(roleB.id), targetType: 'role', guildId: GUILD_ID });
      await roleB.setName(`parity-test-${ts()}-legit`);
      await wait(22000);
      const rolefalse = drifts.slice(beforeRoleB).find(r => String(r.event.targetId) === String(roleB.id));
      record('2b: recorded role update - no drift', !rolefalse, rolefalse ? 'FALSE POSITIVE' : 'reconciled cleanly');
    } else {
      record('2a: role tests', false, 'ManageRoles permission missing - skipped');
      record('2b: role tests', false, 'ManageRoles permission missing - skipped');
    }

    // ---- SECTION 3: Webhook tests ----
    console.log('\n[3] Webhook tests');

    if (perms.ManageWebhooks) {
      const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
      const targetChannel = textChannels.first() || chA;
      const wh = await targetChannel.createWebhook({ name: `parity-test-${ts()}`, reason: 'parity live test' });
      created.webhooks.push(wh);
      console.log(`  created webhook ${wh.name} (${wh.id})`);
      const webhookDrift = await waitDrift(r => String(r.event.targetId) === String(wh.id), 25000);
      record('3a: unrecorded webhook create is drift', !!webhookDrift, webhookDrift ? `actionType=${webhookDrift.event.actionType}` : 'no drift in 25s');
    } else {
      record('3a: webhook tests', false, 'ManageWebhooks permission missing - skipped');
    }

    // ---- SECTION 4: Self-message drift ----
    console.log('\n[4] Self-message test');

    if (perms.SendMessages) {
      const beforeMsg = drifts.length;
      await chA.send('parity live full test self-message');
      const msgDrift = await waitDrift(r => r.event.actionType === 'MESSAGE_CREATE', 15000);
      record('4a: unrecorded self-message is drift', !!msgDrift, msgDrift ? `targetId=${msgDrift.event.targetId}` : 'no drift in 15s');

      // 4b: Recorded self-message -> no drift
      await parity.intent({ actionType: 'MESSAGE_CREATE', targetId: 'pending', targetType: 'message', guildId: GUILD_ID });
      // The intent above uses targetId 'pending' because we don't know the message ID yet.
      // This demonstrates the limitation: message sends need a post-hoc ledger update or a pre-allocated ID.
      // In practice, use parity.track() wrapping the send when it is available.
      record('4b: recorded self-message reconciliation (documented limitation)', false, 'targetId not known pre-send; use parity.track() in production');
    } else {
      record('4a/4b: self-message test', false, 'SendMessages permission missing - skipped');
    }

    // ---- SECTION 5: Concurrent reconciliation ----
    console.log('\n[5] Concurrency test (offline)');

    const { Ledger, Reconciler } = await import('../parity-js/src/index.js');
    const NOW = Date.parse('2026-08-08T00:00:00.000Z');
    const clk = () => NOW;
    const testLedger = new Ledger({ clock: clk });
    await Promise.all([...Array(1000)].map((_, i) => testLedger.record({
      actionType: 'CHANNEL_UPDATE', targetId: String(i), targetType: 'channel', guildId: GUILD_ID, correlationId: `concurrent-${i}`
    })));
    const testRec = new Reconciler({ ledger: testLedger, clock: clk });
    const concResults = await Promise.all([...Array(1000)].map((_, i) => testRec.reconcile({
      actionType: 'CHANNEL_UPDATE', targetId: String(i), targetType: 'channel', guildId: GUILD_ID,
      executorId: 'bot', auditEntryId: `ae-${i}`, occurredAt: new Date(NOW).toISOString(), count: 1
    })));
    const allNull = concResults.every(r => r === null);
    const remaining = (await testLedger.entries()).length;
    record('5a: 1000 concurrent reconciliations produce no drift and no leaked entries', allNull && remaining === 0, `leaked=${remaining}`);

    await cleanup();
    printSummary();
    process.exit(0);
  } catch (err) {
    console.error('TEST ERROR:', err.stack ?? err.message);
    await cleanup();
    printSummary();
    process.exit(1);
  }
});

function printSummary() {
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log('\n========== LIVE FULL TEST SUMMARY ==========');
  for (const r of results) console.log(`  ${r.pass ? '[PASS]' : '[FAIL]'} ${r.name}${r.detail ? '  -  ' + r.detail : ''}`);
  console.log(`\n${pass}/${results.length} passed  |  ${fail} failed`);

  const unique = [...new Map(rawShapes.map(s => [`${s.action}|${s.actionType}|${s.targetType}`, s])).values()];
  console.log('\nLearned audit shapes this run:');
  for (const s of unique) console.log(`  action=${s.action}  actionType="${s.actionType}"  targetType="${s.targetType}"`);

  const reportPath = join(resolve('.'), 'live-test-report.json');
  writeFileSync(reportPath, JSON.stringify({ ran: new Date().toISOString(), guildId: GUILD_ID, results, rawShapes: unique }, null, 2));
  console.log(`\nReport written to ${reportPath}`);
}

client.on('error', err => console.error('Client error:', err.message));
await client.login(TOKEN);
