import asyncio
import copy
import inspect
import json
import sqlite3
import uuid
from datetime import datetime, timezone

COLLAPSED = {'MEMBER_MOVE', 'MEMBER_DISCONNECT', 'MESSAGE_DELETE'}
MAX_AUDIT_COUNT = 10000
ACTIONS = {1:'GUILD_UPDATE',10:'CHANNEL_CREATE',11:'CHANNEL_UPDATE',12:'CHANNEL_DELETE',13:'CHANNEL_OVERWRITE_CREATE',14:'CHANNEL_OVERWRITE_UPDATE',15:'CHANNEL_OVERWRITE_DELETE',20:'MEMBER_KICK',21:'MEMBER_PRUNE',22:'MEMBER_BAN_ADD',23:'MEMBER_BAN_REMOVE',24:'MEMBER_UPDATE',25:'MEMBER_ROLE_UPDATE',26:'MEMBER_MOVE',27:'MEMBER_DISCONNECT',28:'BOT_ADD',30:'ROLE_CREATE',31:'ROLE_UPDATE',32:'ROLE_DELETE',40:'INVITE_CREATE',41:'INVITE_UPDATE',42:'INVITE_DELETE',50:'WEBHOOK_CREATE',51:'WEBHOOK_UPDATE',52:'WEBHOOK_DELETE',60:'EMOJI_CREATE',61:'EMOJI_UPDATE',62:'EMOJI_DELETE',72:'MESSAGE_DELETE',73:'MESSAGE_BULK_DELETE',74:'MESSAGE_PIN',75:'MESSAGE_UNPIN',80:'INTEGRATION_CREATE',81:'INTEGRATION_UPDATE',82:'INTEGRATION_DELETE',83:'STAGE_INSTANCE_CREATE',84:'STAGE_INSTANCE_UPDATE',85:'STAGE_INSTANCE_DELETE',90:'STICKER_CREATE',91:'STICKER_UPDATE',92:'STICKER_DELETE',100:'GUILD_SCHEDULED_EVENT_CREATE',101:'GUILD_SCHEDULED_EVENT_UPDATE',102:'GUILD_SCHEDULED_EVENT_DELETE',110:'THREAD_CREATE',111:'THREAD_UPDATE',112:'THREAD_DELETE',121:'APPLICATION_COMMAND_PERMISSION_UPDATE',130:'SOUNDBOARD_SOUND_CREATE',131:'SOUNDBOARD_SOUND_UPDATE',132:'SOUNDBOARD_SOUND_DELETE',140:'AUTO_MODERATION_RULE_CREATE',141:'AUTO_MODERATION_RULE_UPDATE',142:'AUTO_MODERATION_RULE_DELETE',143:'AUTO_MODERATION_BLOCK_MESSAGE',144:'AUTO_MODERATION_FLAG_TO_CHANNEL',145:'AUTO_MODERATION_USER_COMMUNICATION_DISABLED',146:'AUTO_MODERATION_QUARANTINE_USER',150:'CREATOR_MONETIZATION_REQUEST_CREATED',151:'CREATOR_MONETIZATION_TERMS_ACCEPTED',163:'ONBOARDING_PROMPT_CREATE',164:'ONBOARDING_PROMPT_UPDATE',165:'ONBOARDING_PROMPT_DELETE',166:'ONBOARDING_CREATE',167:'ONBOARDING_UPDATE',190:'HOME_SETTINGS_CREATE',191:'HOME_SETTINGS_UPDATE',192:'VOICE_CHANNEL_STATUS_UPDATE',193:'VOICE_CHANNEL_STATUS_DELETE'}
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
    def __init__(self, client, reconciler, dispatcher, bot_user_id, wait_for_pending=None, clock=lambda: int(datetime.now().timestamp() * 1000), dedupe_ttl_ms=600000):
        self.client, self.reconciler, self.dispatcher, self.bot_user_id = client, reconciler, dispatcher, bot_user_id
        self.wait_for_pending, self.clock, self.dedupe_ttl_ms, self.seen = wait_for_pending or (lambda: asyncio.sleep(0)), clock, dedupe_ttl_ms, {}
    def duplicate(self, audit_id):
        if audit_id is None: return False
        now = self.clock()
        self.seen = {key: seen_at for key, seen_at in self.seen.items() if seen_at + self.dedupe_ttl_ms >= now}
        if audit_id in self.seen: return True
        self.seen[audit_id] = now
        return False
    async def handle_audit(self, entry):
        event = self.normalize_audit(entry)
        if event['executorId'] != str(self.bot_user_id()) or self.duplicate(event['auditEntryId']): return None
        await self.wait_for_pending()
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
        await self.wait_for_pending()
        report = await self.reconciler.reconcile(event)
        if report: await self.dispatcher.dispatch(report)
        return report

def _discord_py_entry_to_dict(entry):
    extra = getattr(entry, 'extra', None) or {}
    channel = getattr(extra, 'channel', None)
    count = getattr(extra, 'count', None) or 1
    target = getattr(entry, 'target', None)
    user = getattr(entry, 'user', None)
    guild = getattr(entry, 'guild', None)
    action = entry.action.value if hasattr(entry.action, 'value') else int(entry.action)
    action_type = ACTIONS.get(action, f'UNKNOWN_{action}')
    return {
        'id': str(entry.id),
        'action': action,
        'targetId': str(target.id) if target else 'unknown',
        'targetType': 'channel' if action_type in {'MEMBER_MOVE', 'MEMBER_DISCONNECT'} else _target_type_for_action(action_type),
        'guildId': str(guild.id) if guild else '',
        'executorId': str(user.id) if user else str(getattr(entry, 'user_id', '') or ''),
        'createdTimestamp': int(entry.created_at.timestamp() * 1000),
        'count': count,
        'extra': {'channel': {'id': str(channel.id)}} if channel else {},
    }

def _target_type_for_action(action_type):
    if action_type == 'GUILD_UPDATE': return 'guild'
    if action_type.startswith('CHANNEL_') or action_type.startswith('VOICE_CHANNEL_STATUS_'): return 'channel'
    if action_type.startswith('ROLE_'): return 'role'
    if action_type.startswith('INVITE_'): return 'invite'
    if action_type.startswith('WEBHOOK_'): return 'webhook'
    if action_type.startswith('EMOJI_'): return 'emoji'
    if action_type.startswith('STICKER_'): return 'sticker'
    if action_type.startswith('INTEGRATION_'): return 'integration'
    if action_type.startswith('STAGE_INSTANCE_'): return 'stageinstance'
    if action_type.startswith('GUILD_SCHEDULED_EVENT_'): return 'guildscheduledevent'
    if action_type.startswith('THREAD_'): return 'thread'
    if action_type.startswith('SOUNDBOARD_SOUND_'): return 'soundboardsound'
    if action_type == 'APPLICATION_COMMAND_PERMISSION_UPDATE': return 'applicationcommand'
    if action_type.startswith('AUTO_MODERATION_RULE_'): return 'automoderation'
    if action_type.startswith('ONBOARDING_PROMPT_'): return 'guildonboardingprompt'
    if action_type.startswith('ONBOARDING_'): return 'guildonboarding'
    if action_type.startswith('MEMBER_') or action_type == 'BOT_ADD': return 'user'
    if action_type.startswith('MESSAGE_') or action_type.startswith('AUTO_MODERATION_'): return 'message'
    return 'unknown'

def _discord_py_raw_entry_to_dict(entry):
    action = entry.action_type.value if hasattr(entry.action_type, 'value') else int(entry.action_type)
    action_type = ACTIONS.get(action, f'UNKNOWN_{action}')
    extra = entry.extra if isinstance(entry.extra, dict) else {}
    channel_id = extra.get('channel_id')
    count = extra.get('count', 1)
    try: count = int(count)
    except (TypeError, ValueError): count = 1
    target_id = channel_id if action_type in {'MEMBER_MOVE', 'MEMBER_DISCONNECT'} and channel_id else entry.target_id
    created_ms = (int(entry.id) >> 22) + 1420070400000
    return {
        'id': str(entry.id),
        'action': action,
        'targetId': str(target_id) if target_id is not None else 'unknown',
        'targetType': 'channel' if action_type in {'MEMBER_MOVE', 'MEMBER_DISCONNECT'} else _target_type_for_action(action_type),
        'guildId': str(entry.guild_id),
        'executorId': str(entry.user_id) if entry.user_id is not None else '',
        'createdTimestamp': created_ms,
        'count': count,
        'extra': {'channel': {'id': str(channel_id)}} if channel_id else {'count': count},
    }

async def attach(client, **options):
    clock = options.get('clock', lambda: int(datetime.now().timestamp() * 1000))
    ledger = options.get('ledger') or Ledger(clock=clock)
    dispatcher = options.get('dispatcher') or AlertDispatcher(options.get('strategies', ()))
    reconciler = options.get('reconciler') or Reconciler(ledger, clock=clock, tolerance_ms=options.get('tolerance_ms', 120000))
    bot_user_id = options.get('bot_user_id', lambda: getattr(client.user if client else None, 'id', None))
    pending = set()
    async def wait_for_pending():
        snapshot = list(pending)
        if snapshot:
            await asyncio.wait(snapshot, timeout=options.get('pending_wait_ms', 5000) / 1000)
    listener = AuditListener(client, reconciler, dispatcher, bot_user_id, wait_for_pending, clock)

    # discord.py dispatches on_audit_log_entry_create. Pycord uses a raw event in
    # versions where the high-level event can be suppressed by cache misses.
    if client is not None:
        async def _audit_handler(entry):
            await listener.handle_audit(_discord_py_entry_to_dict(entry))
        async def _raw_audit_handler(entry):
            await listener.handle_audit(_discord_py_raw_entry_to_dict(entry))
        async def _message_handler(message):
            author = getattr(message, 'author', None)
            guild = getattr(message, 'guild', None)
            if author is None or guild is None:
                return
            await listener.handle_message({
                'id': str(message.id),
                'guildId': str(guild.id),
                'author': {'id': str(author.id)},
                'createdTimestamp': int(message.created_at.timestamp() * 1000),
            })
        handlers = [
            (_audit_handler, 'on_audit_log_entry_create'),
            (_audit_handler, 'on_audit_log_entry'),
            (_raw_audit_handler, 'on_raw_audit_log_entry'),
            (_message_handler, 'on_message'),
        ]
        if callable(getattr(client, 'add_listener', None)):
            for handler, event_name in handlers:
                client.add_listener(handler, event_name)
            listener._registered_handlers = handlers
        else:
            patched = []
            for handler, event_name in handlers:
                existing = getattr(client, event_name, None)
                async def combined(*args, _existing=existing, _handler=handler):
                    await _handler(*args)
                    if _existing is not None:
                        result = _existing(*args)
                        if inspect.isawaitable(result): await result
                setattr(client, event_name, combined)
                patched.append((event_name, existing, combined))
            listener._patched_handlers = patched

    async def detach():
        if client is not None:
            if callable(getattr(client, 'remove_listener', None)):
                for handler, event_name in getattr(listener, '_registered_handlers', ()):
                    client.remove_listener(handler, event_name)
            for event_name, existing, combined in getattr(listener, '_patched_handlers', ()):
                if getattr(client, event_name, None) is not combined: continue
                if existing is None: delattr(client, event_name)
                else: setattr(client, event_name, existing)

    async def track(intent, operation):
        if callable(intent):
            marker = asyncio.get_running_loop().create_future()
            pending.add(marker)
            try:
                result = operation()
                if inspect.isawaitable(result):
                    result = await result
                await ledger.record(intent(result))
                return result
            finally:
                pending.discard(marker)
                if not marker.done(): marker.set_result(None)
        entry = await ledger.record(intent)
        try:
            result = operation()
            return await result if inspect.isawaitable(result) else result
        except BaseException:
            await ledger.remove(entry['correlationId'])
            raise

    return {
        'ledger': ledger,
        'reconciler': reconciler,
        'dispatcher': dispatcher,
        'listener': listener,
        'intent': ledger.record,
        'track': track,
        'detach': detach,
    }
