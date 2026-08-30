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

const { Client, GatewayIntentBits, ChannelType, Events, PermissionsBitField } = await import('discord.js');
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

async function waitDrift(match, ms = 25000, start = 0) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = drifts.slice(start).find(match);
    if (hit) return hit;
    await wait(1000);
  }
  return null;
}

const actionDrift = (actionType, targetId, start, ms) => waitDrift(
  report => report.event.actionType === actionType && String(report.event.targetId) === String(targetId),
  ms,
  start,
);

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
    gatewayClockDeltaMs: Date.now() - entry.createdTimestamp,
  };
  rawShapes.push(shape);
});

async function cleanup() {
  console.log('\n-- cleanup --');
  try { parity?.detach(); } catch {}
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
  client.destroy();
}

let parity;

client.once(Events.ClientReady, async () => {
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

    const rawChannels = guild.channels;
    const rawRoles = guild.roles;
    parity = attach(client, { autoWrap: true, strategies: [{ send: async r => { drifts.push(r); } }] });

    console.log('\n[1] Channel tests');

    let before = drifts.length;
    const chA = await rawChannels.create({ name: `parity-test-${ts()}`, type: ChannelType.GuildText, topic: 'parity init', reason: 'parity live test' });
    created.channels.push(chA);
    console.log(`  created channel ${chA.name} (${chA.id})`);
    const createDrift = await actionDrift('CHANNEL_CREATE', chA.id, before);
    record('1a: unrecorded channel create is drift', !!createDrift, createDrift ? `actionType=${createDrift.event.actionType}` : 'no drift in 25s');

    before = drifts.length;
    await rawChannels.edit(chA.id, { topic: 'rogue update', reason: 'parity live test' });
    const rogueUpdate = await actionDrift('CHANNEL_UPDATE', chA.id, before);
    record('1b: unrecorded channel update is drift', !!rogueUpdate, rogueUpdate ? `actionType=${rogueUpdate.event.actionType}` : 'no drift in 25s');

    before = drifts.length;
    const chB = await rawChannels.create({ name: `parity-test-${ts()}`, type: ChannelType.GuildText, topic: 'parity init', reason: 'parity live test' });
    created.channels.push(chB);
    await actionDrift('CHANNEL_CREATE', chB.id, before);
    const beforeB = drifts.length;
    await parity.intent({ actionType: 'CHANNEL_UPDATE', targetId: String(chB.id), targetType: 'channel', guildId: GUILD_ID });
    await rawChannels.edit(chB.id, { topic: 'legit update - 1.0.1 naive shape', reason: 'parity live test' });
    const falseDrift = await actionDrift('CHANNEL_UPDATE', chB.id, beforeB, 12000);
    record('1c: manual CHANNEL_UPDATE intent reconciles', !falseDrift, falseDrift ? 'FALSE POSITIVE' : 'reconciled cleanly');

    before = drifts.length;
    const chC = await guild.channels.create({ name: `parity-test-${ts()}`, type: ChannelType.GuildText, topic: 'auto-wrap init', reason: 'parity live test' });
    created.channels.push(chC);
    const wrappedCreateDrift = await actionDrift('CHANNEL_CREATE', chC.id, before, 12000);
    record('1d: auto-wrapped channel create reconciles', !wrappedCreateDrift, wrappedCreateDrift ? 'FALSE POSITIVE' : 'reconciled cleanly');
    before = drifts.length;
    await guild.channels.edit(chC.id, { topic: 'auto-wrapped update', reason: 'parity live test' });
    const wrappedUpdateDrift = await actionDrift('CHANNEL_UPDATE', chC.id, before, 12000);
    record('1e: auto-wrapped channel update reconciles', !wrappedUpdateDrift, wrappedUpdateDrift ? 'FALSE POSITIVE' : 'reconciled cleanly');

    console.log('\n[2] Role tests');

    if (perms.ManageRoles) {
      before = drifts.length;
      const role = await rawRoles.create({ name: `parity-test-${ts()}`, reason: 'parity live test', permissions: [] });
      created.roles.push(role);
      console.log(`  created role ${role.name} (${role.id})`);
      await actionDrift('ROLE_CREATE', role.id, before);

      const beforeRole = drifts.length;
      await rawRoles.edit(role.id, { name: `parity-test-${ts()}-updated`, reason: 'parity live test' });
      const roleDrift = await actionDrift('ROLE_UPDATE', role.id, beforeRole);
      record('2a: unrecorded role update is drift', !!roleDrift, roleDrift ? `actionType=${roleDrift.event.actionType}` : 'no drift in 25s');

      before = drifts.length;
      const roleB = await rawRoles.create({ name: `parity-test-${ts()}`, reason: 'parity live test', permissions: [] });
      created.roles.push(roleB);
      await actionDrift('ROLE_CREATE', roleB.id, before);
      const beforeRoleB = drifts.length;
      await parity.intent({ actionType: 'ROLE_UPDATE', targetId: String(roleB.id), targetType: 'role', guildId: GUILD_ID });
      await rawRoles.edit(roleB.id, { name: `parity-test-${ts()}-legit`, reason: 'parity live test' });
      const rolefalse = await actionDrift('ROLE_UPDATE', roleB.id, beforeRoleB, 12000);
      record('2b: recorded role update - no drift', !rolefalse, rolefalse ? 'FALSE POSITIVE' : 'reconciled cleanly');

      before = drifts.length;
      const roleC = await guild.roles.create({ name: `parity-test-${ts()}`, reason: 'parity live test', permissions: [] });
      created.roles.push(roleC);
      const wrappedRoleCreateDrift = await actionDrift('ROLE_CREATE', roleC.id, before, 12000);
      record('2c: auto-wrapped role create reconciles', !wrappedRoleCreateDrift, wrappedRoleCreateDrift ? 'FALSE POSITIVE' : 'reconciled cleanly');
      before = drifts.length;
      await guild.roles.edit(roleC.id, { name: `parity-test-${ts()}-auto`, reason: 'parity live test' });
      const wrappedRoleUpdateDrift = await actionDrift('ROLE_UPDATE', roleC.id, before, 12000);
      record('2d: auto-wrapped role update reconciles', !wrappedRoleUpdateDrift, wrappedRoleUpdateDrift ? 'FALSE POSITIVE' : 'reconciled cleanly');
    } else {
      record('2a: role tests', false, 'ManageRoles permission missing - skipped');
      record('2b: role tests', false, 'ManageRoles permission missing - skipped');
    }

    console.log('\n[3] Webhook tests');

    if (perms.ManageWebhooks) {
      const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
      const targetChannel = textChannels.first() || chA;
      before = drifts.length;
      const wh = await targetChannel.createWebhook({ name: `parity-test-${ts()}`, reason: 'parity live test' });
      created.webhooks.push(wh);
      console.log(`  created webhook ${wh.name} (${wh.id})`);
      const webhookDrift = await actionDrift('WEBHOOK_CREATE', wh.id, before, 25000);
      record('3a: unrecorded webhook create is drift', !!webhookDrift, webhookDrift ? `actionType=${webhookDrift.event.actionType}` : 'no drift in 25s');
    } else {
      record('3a: webhook tests', false, 'ManageWebhooks permission missing - skipped');
    }

    console.log('\n[4] Self-message test');

    if (perms.SendMessages) {
      const beforeMsg = drifts.length;
      const rogueMessage = await chA.send('parity live full test unrecorded self-message');
      const msgDrift = await actionDrift('MESSAGE_CREATE', rogueMessage.id, beforeMsg, 15000);
      record('4a: unrecorded self-message is drift', !!msgDrift, msgDrift ? `targetId=${msgDrift.event.targetId}` : 'no drift in 15s');

      const beforeTrackedMessage = drifts.length;
      const trackedMessage = await parity.track(
        message => ({ actionType: 'MESSAGE_CREATE', targetId: String(message.id), targetType: 'message', guildId: GUILD_ID }),
        () => chA.send('parity live full test tracked self-message'),
      );
      const trackedMessageDrift = await actionDrift('MESSAGE_CREATE', trackedMessage.id, beforeTrackedMessage, 15000);
      record('4b: result-derived tracked self-message reconciles', !trackedMessageDrift, trackedMessageDrift ? 'gateway beat post-result ledger write' : 'reconciled cleanly');
    } else {
      record('4a/4b: self-message test', false, 'SendMessages permission missing - skipped');
    }

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
    process.exit(results.some(result => !result.pass) ? 1 : 0);
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
