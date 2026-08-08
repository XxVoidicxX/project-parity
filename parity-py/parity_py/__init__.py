import asyncio
import copy
import json
import sqlite3
import uuid
from datetime import datetime, timezone

COLLAPSED = {'MEMBER_MOVE', 'MEMBER_DISCONNECT', 'MESSAGE_DELETE'}
MAX_AUDIT_COUNT = 10000
ACTIONS = {10:'CHANNEL_CREATE',11:'CHANNEL_UPDATE',12:'CHANNEL_DELETE',26:'MEMBER_MOVE',27:'MEMBER_DISCONNECT',72:'MESSAGE_DELETE',73:'MESSAGE_BULK_DELETE',1:'GUILD_UPDATE',20:'MEMBER_KICK',22:'MEMBER_BAN_ADD',30:'ROLE_CREATE',31:'ROLE_UPDATE',50:'WEBHOOK_CREATE',60:'EMOJI_CREATE',80:'INTEGRATION_CREATE',90:'STICKER_CREATE',100:'GUILD_SCHEDULED_EVENT_CREATE',110:'THREAD_CREATE',120:'APPLICATION_COMMAND_PERMISSION_UPDATE',140:'AUTO_MODERATION_RULE_CREATE'}
REMEDIATION = ['Immediately rotate the bot token.', 'Inspect running bot instances and deployment credentials.', 'Preserve this report and relevant Discord audit logs for investigation.']

def iso(value):
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def ms(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)

class MemoryLedgerAdapter:
    def __init__(self): self.data = {}
    async def insert(self, entry): self.data[entry['correlationId']] = copy.deepcopy(entry)
    async def has(self, correlation_id): return correlation_id in self.data
    async def all(self): return [copy.deepcopy(entry) for entry in self.data.values()]
    async def remove(self, correlation_id): self.data.pop(correlation_id, None)

class SqliteLedgerAdapter:
    def __init__(self, path=':memory:'):
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS parity_ledger (id TEXT PRIMARY KEY, payload TEXT)')
    async def insert(self, entry):
        self.db.execute('INSERT INTO parity_ledger VALUES (?,?)', (entry['correlationId'], json.dumps(entry)))
        self.db.commit()
    async def all(self): return [json.loads(row[0]) for row in self.db.execute('SELECT payload FROM parity_ledger')]
    async def remove(self, correlation_id):
        self.db.execute('DELETE FROM parity_ledger WHERE id=?', (correlation_id,))
        self.db.commit()
    def close(self): self.db.close()

class Ledger:
    def __init__(self, adapter=None, ttl_ms=120000, clock=lambda: int(datetime.now().timestamp() * 1000)):
        self.adapter = adapter or MemoryLedgerAdapter()
        self.ttl_ms = ttl_ms
        self.clock = clock
        self._record_lock = asyncio.Lock()
    async def record(self, intent):
        async with self._record_lock:
            action_type = str(intent['actionType'])
            if action_type.startswith('UNKNOWN_'):
                raise ValueError('Unknown audit actions cannot be ledgered until they are mapped')
            correlation_id = str(intent.get('correlationId') or uuid.uuid4())
            duplicate = await self.adapter.has(correlation_id) if hasattr(self.adapter, 'has') else any(entry['correlationId'] == correlation_id for entry in await self.entries())
            if duplicate:
                raise ValueError(f'Duplicate correlationId: {correlation_id}')
            timestamp = iso(intent.get('timestamp', self.clock()))
            entry = {'actionType': action_type, 'targetId': str(intent['targetId']), 'targetType': str(intent.get('targetType', 'unknown')), 'guildId': str(intent['guildId']), 'timestamp': timestamp, 'correlationId': correlation_id, 'expiresAt': iso(intent.get('expiresAt', ms(timestamp) + self.ttl_ms))}
            if 'metadata' in intent:
                entry['metadata'] = copy.deepcopy(intent['metadata'])
            await self.adapter.insert(entry)
            return entry
    async def entries(self): return await self.adapter.all()
    async def remove(self, correlation_id): await self.adapter.remove(correlation_id)
    async def purge(self, now=None, retention_ms=None):
        now = self.clock() if now is None else now
        retention_ms = self.ttl_ms if retention_ms is None else retention_ms
        for entry in await self.entries():
            if ms(entry['expiresAt']) + retention_ms < now:
                await self.remove(entry['correlationId'])

class Reconciler:
    def __init__(self, ledger, clock=lambda: int(datetime.now().timestamp() * 1000), tolerance_ms=120000):
        self.ledger, self.clock, self.tolerance_ms, self.lock = ledger, clock, tolerance_ms, asyncio.Lock()
    @staticmethod
    def _count(value):
        try: count = int(value)
        except (TypeError, ValueError, OverflowError): return 1, False
        return (count, True) if isinstance(value, int) and not isinstance(value, bool) and 1 <= count <= MAX_AUDIT_COUNT else (min(max(count, 1), MAX_AUDIT_COUNT), False)
    async def reconcile(self, event):
        async with self.lock:
            count, valid_count = self._count(event.get('count', 1))
            canonical = {**event, 'actionType': str(event['actionType']), 'targetId': str(event['targetId']), 'targetType': str(event['targetType']), 'guildId': str(event['guildId']), 'executorId': str(event['executorId']), 'auditEntryId': None if event.get('auditEntryId') is None else str(event['auditEntryId']), 'count': count}
            entries = await self.ledger.entries()
            if not valid_count:
                return self.report(canonical, self.nearest(canonical, entries))
            eligible = [entry for entry in entries if entry['guildId'] == canonical['guildId'] and entry['actionType'] == canonical['actionType'] and entry['targetType'] == canonical['targetType'] and ms(entry['expiresAt']) >= ms(canonical['occurredAt']) and abs(ms(entry['timestamp']) - ms(canonical['occurredAt'])) <= self.tolerance_ms]
            burst = canonical['actionType'] in COLLAPSED and count > 1
            selected = sorted(eligible, key=lambda entry: (ms(entry['timestamp']), entry['correlationId']))[:count] if burst else sorted((entry for entry in eligible if entry['targetId'] == canonical['targetId']), key=lambda entry: (ms(entry['timestamp']), entry['correlationId']))[:1]
            for entry in selected:
                await self.ledger.remove(entry['correlationId'])
            if len(selected) >= count:
                return None
            return self.report(canonical, self.nearest(canonical, [entry for entry in entries if entry not in selected]))
    def nearest(self, event, entries):
        candidates = [entry for entry in entries if entry['guildId'] == event['guildId']]
        if not candidates: return None
        return sorted(candidates, key=lambda entry: (-((4 if entry['actionType'] == event['actionType'] else 0) + (2 if entry['targetId'] == event['targetId'] else 0) + (1 if ms(entry['expiresAt']) >= ms(event['occurredAt']) else 0)), abs(ms(entry['timestamp']) - ms(event['occurredAt'])), entry['correlationId']))[0]
    def report(self, event, near):
        state = 'none' if near is None else ('expired' if ms(near['expiresAt']) < ms(event['occurredAt']) else 'partial')
        projection = None if near is None else {key: near[key] for key in ['actionType', 'targetId', 'guildId', 'correlationId', 'timestamp', 'expiresAt']}
        return {'schemaVersion': '1.0', 'kind': 'drift', 'detectedAt': iso(self.clock()), 'event': {key: event[key] for key in ['actionType', 'targetId', 'targetType', 'guildId', 'executorId', 'auditEntryId', 'occurredAt', 'count']}, 'ledger': {'state': state, 'nearest': projection}, 'confidence': 'medium' if state == 'partial' else 'high', 'suggestedRemediation': REMEDIATION}

class AlertDispatcher:
    def __init__(self, strategies=()): self.strategies = strategies
    async def dispatch(self, report): await asyncio.gather(*(strategy.send(report) for strategy in self.strategies))

class AuditListener:
    def __init__(self, client, reconciler, dispatcher, bot_user_id): self.client, self.reconciler, self.dispatcher, self.bot_user_id = client, reconciler, dispatcher, bot_user_id
    async def handle_audit(self, entry):
        event = self.normalize_audit(entry)
        if event['executorId'] != str(self.bot_user_id()): return None
        report = await self.reconciler.reconcile(event)
        if report: await self.dispatcher.dispatch(report)
        return report
    @staticmethod
    def normalize_audit(entry):
        action = entry.get('action', entry.get('actionType'))
        action_type = ACTIONS.get(action, action if isinstance(action, str) else f'UNKNOWN_{action}')
        target, extra = entry.get('target') or {}, entry.get('extra') or {}
        channel = extra.get('channel') or {}
        voice_channel = channel.get('id') if action_type in {'MEMBER_MOVE', 'MEMBER_DISCONNECT'} else None
        occurred_at = entry.get('occurredAt') or iso(entry.get('createdTimestamp', entry.get('createdAt', 0)))
        audit_entry_id = entry.get('auditEntryId') if entry.get('id') is None else str(entry['id'])
        return {**entry, 'actionType': action_type, 'targetId': str(voice_channel if voice_channel is not None else entry.get('targetId', target.get('id', channel.get('id', 'unknown')))), 'targetType': 'channel' if voice_channel is not None else str(entry.get('targetType', target.get('type', 'unknown'))).lower(), 'guildId': str(entry.get('guildId', (entry.get('guild') or {}).get('id', ''))), 'executorId': str(entry.get('executorId', (entry.get('executor') or {}).get('id', ''))), 'auditEntryId': audit_entry_id, 'occurredAt': occurred_at, 'count': extra.get('count', entry.get('count', 1))}
    async def handle_message(self, message):
        author = message.get('author', {})
        if str(author.get('id')) != str(self.bot_user_id()) or not message.get('guildId'): return None
        event = {'actionType': 'MESSAGE_CREATE', 'targetId': str(message['id']), 'targetType': 'message', 'guildId': str(message['guildId']), 'executorId': str(author['id']), 'auditEntryId': None, 'occurredAt': iso(message.get('createdTimestamp', 0)), 'count': 1}
        report = await self.reconciler.reconcile(event)
        if report: await self.dispatcher.dispatch(report)
        return report

async def attach(client, **options):
    clock = options.get('clock', lambda: int(datetime.now().timestamp() * 1000))
    ledger = options.get('ledger', Ledger(clock=clock))
    dispatcher = options.get('dispatcher', AlertDispatcher())
    reconciler = options.get('reconciler', Reconciler(ledger, clock=clock))
    return {'ledger': ledger, 'reconciler': reconciler, 'dispatcher': dispatcher, 'listener': AuditListener(client, reconciler, dispatcher, options.get('bot_user_id', lambda: getattr(client.user, 'id', None))), 'intent': ledger.record}
