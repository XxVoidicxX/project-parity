import asyncio, json, sqlite3, uuid
from datetime import datetime, timezone
COLLAPSED={'MEMBER_MOVE','MEMBER_DISCONNECT','MESSAGE_DELETE'}
ACTIONS={10:'CHANNEL_CREATE',11:'CHANNEL_UPDATE',12:'CHANNEL_DELETE',26:'MEMBER_MOVE',27:'MEMBER_DISCONNECT',72:'MESSAGE_DELETE',73:'MESSAGE_BULK_DELETE',1:'GUILD_UPDATE',20:'MEMBER_KICK',22:'MEMBER_BAN_ADD',30:'ROLE_CREATE',31:'ROLE_UPDATE',50:'WEBHOOK_CREATE',60:'EMOJI_CREATE',80:'INTEGRATION_CREATE',90:'STICKER_CREATE',100:'GUILD_SCHEDULED_EVENT_CREATE',110:'THREAD_CREATE',120:'APPLICATION_COMMAND_PERMISSION_UPDATE',140:'AUTO_MODERATION_RULE_CREATE'}
def iso(value):
    if isinstance(value,str): return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    return datetime.fromtimestamp(value/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def ms(value): return int(datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000)
class MemoryLedgerAdapter:
    def __init__(self): self.data={}
    async def insert(self,e): self.data[e['correlationId']]=dict(e)
    async def has(self,k): return k in self.data
    async def all(self): return [dict(e) for e in self.data.values()]
    async def remove(self,k): self.data.pop(k,None)
class SqliteLedgerAdapter:
    def __init__(self,path=':memory:'): self.db=sqlite3.connect(path); self.db.execute('CREATE TABLE IF NOT EXISTS parity_ledger (id TEXT PRIMARY KEY,payload TEXT)')
    async def insert(self,e): self.db.execute('INSERT OR REPLACE INTO parity_ledger VALUES (?,?)',(e['correlationId'],json.dumps(e))); self.db.commit()
    async def all(self): return [json.loads(x[0]) for x in self.db.execute('SELECT payload FROM parity_ledger')]
    async def remove(self,k): self.db.execute('DELETE FROM parity_ledger WHERE id=?',(k,)); self.db.commit()
    def close(self): self.db.close()
class Ledger:
    def __init__(self,adapter=None,ttl_ms=120000,clock=lambda: int(datetime.now().timestamp()*1000)): self.adapter=adapter or MemoryLedgerAdapter(); self.ttl_ms=ttl_ms; self.clock=clock
    async def record(self,i):
        action_type=str(i['actionType'])
        if action_type.startswith('UNKNOWN_'): raise ValueError('Unknown audit actions cannot be ledgered until they are mapped')
        correlation_id=str(i.get('correlationId') or uuid.uuid4())
        duplicate=await self.adapter.has(correlation_id) if hasattr(self.adapter,'has') else any(e['correlationId']==correlation_id for e in await self.entries())
        if duplicate: raise ValueError(f'Duplicate correlationId: {correlation_id}')
        t=iso(i.get('timestamp',self.clock())); e={'actionType':action_type,'targetId':str(i['targetId']),'targetType':str(i.get('targetType','unknown')),'guildId':str(i['guildId']),'timestamp':t,'correlationId':correlation_id,'expiresAt':iso(i.get('expiresAt',ms(t)+self.ttl_ms))};
        if 'metadata'in i:e['metadata']=i['metadata']
        await self.adapter.insert(e); return e
    async def entries(self): return await self.adapter.all()
    async def remove(self,k): await self.adapter.remove(k)
    async def purge(self,now=None,retention_ms=None):
        now=self.clock() if now is None else now; retention_ms=self.ttl_ms if retention_ms is None else retention_ms
        for entry in await self.entries():
            if ms(entry['expiresAt'])+retention_ms < now: await self.remove(entry['correlationId'])
class Reconciler:
    def __init__(self,ledger,clock=lambda: int(datetime.now().timestamp()*1000),tolerance_ms=120000): self.ledger,self.clock,self.tolerance_ms,self.lock=ledger,clock,tolerance_ms,asyncio.Lock()
    async def reconcile(self,event):
      async with self.lock:
        entries=await self.ledger.entries(); eligible=[e for e in entries if e['guildId']==event['guildId'] and e['actionType']==event['actionType'] and e['targetType']==event['targetType'] and ms(e['expiresAt'])>=ms(event['occurredAt']) and abs(ms(e['timestamp'])-ms(event['occurredAt']))<=self.tolerance_ms]
        selected=sorted(eligible,key=lambda e:(ms(e['timestamp']),e['correlationId']))[:event.get('count',1)] if event['actionType'] in COLLAPSED and event.get('count',1)>1 else sorted((e for e in eligible if e['targetId']==event['targetId']),key=lambda e:(ms(e['timestamp']),e['correlationId']))[:1]
        for e in selected: await self.ledger.remove(e['correlationId'])
        if len(selected)>=event.get('count',1): return None
        candidates=[e for e in entries if e['guildId']==event['guildId'] and e not in selected]
        near=sorted(candidates,key=lambda e:(-((4 if e['actionType']==event['actionType'] else 0)+(2 if e['targetId']==event['targetId'] else 0)+(1 if ms(e['expiresAt'])>=self.clock() else 0)),abs(ms(e['timestamp'])-ms(event['occurredAt'])),e['correlationId']))[0] if candidates else None
        state='none' if not near else ('expired' if ms(near['expiresAt'])<self.clock() else 'partial'); projection=None if not near else {k:near[k] for k in ['actionType','targetId','guildId','correlationId','timestamp','expiresAt']}
        return {'schemaVersion':'1.0','kind':'drift','detectedAt':iso(self.clock()),'event':{**event,'count':event.get('count',1),'auditEntryId':event.get('auditEntryId')},'ledger':{'state':state,'nearest':projection},'confidence':'medium' if state=='partial' else 'high','suggestedRemediation':['Immediately rotate the bot token.','Inspect running bot instances and deployment credentials.','Preserve this report and relevant Discord audit logs for investigation.']}
class AlertDispatcher:
    def __init__(self,strategies=()): self.strategies=strategies
    async def dispatch(self,r): await asyncio.gather(*(s.send(r) for s in self.strategies))
class AuditListener:
    def __init__(self,client,reconciler,dispatcher,bot_user_id): self.client,self.reconciler,self.dispatcher,self.bot_user_id=client,reconciler,dispatcher,bot_user_id
    async def handle_audit(self,e):
      if str(e['executorId'])!=str(self.bot_user_id()): return None
      e={**e,'actionType':ACTIONS.get(e['actionType'],e['actionType'] if isinstance(e['actionType'],str) else f"UNKNOWN_{e['actionType']}")}; r=await self.reconciler.reconcile(e)
      if r: await self.dispatcher.dispatch(r)
      return r
    async def handle_message(self,message):
      author=message.get('author',{})
      if str(author.get('id'))!=str(self.bot_user_id()) or not message.get('guildId'): return None
      event={'actionType':'MESSAGE_CREATE','targetId':str(message['id']),'targetType':'message','guildId':str(message['guildId']),'executorId':str(author['id']),'auditEntryId':None,'occurredAt':iso(message.get('createdTimestamp',0)),'count':1}
      report=await self.reconciler.reconcile(event)
      if report: await self.dispatcher.dispatch(report)
      return report
async def attach(client,**options):
    ledger=options.get('ledger',Ledger(clock=options.get('clock',lambda:int(datetime.now().timestamp()*1000)))); dispatcher=options.get('dispatcher',AlertDispatcher()); reconciler=options.get('reconciler',Reconciler(ledger,clock=options.get('clock',lambda:int(datetime.now().timestamp()*1000)))); return {'ledger':ledger,'reconciler':reconciler,'dispatcher':dispatcher,'listener':AuditListener(client,reconciler,dispatcher,options.get('bot_user_id',lambda:getattr(client.user,'id',None))),'intent':ledger.record}
