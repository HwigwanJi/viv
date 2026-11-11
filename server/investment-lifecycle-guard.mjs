const names=['live_automation_activations','live_automation_accounts','live_automation_orders','live_event_runtime','event_paper_subscriptions'];
const present=(field)=>`COALESCE(json_type(${field}),'null')<>'null'`;
/** Read-only predicates, reused in the destructive operation's final SQL CAS.
 * No credential, provider call, order or operational status is changed here. */
export async function investmentLifecycleGuard(db,{owner,profileId=null,requireReleasedAllocations=false}={}){
 const tables=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+names.map(()=>'?').join(',')+')').bind(...names).all()).results.map(row=>row.name)),checks=[];
 if(tables.has('live_automation_activations')){
  const conditions=["a.status NOT IN ('PAUSED','STOPPED','EXPIRED')"];
  if(tables.has('live_automation_accounts'))conditions.push("NOT EXISTS(SELECT 1 FROM live_automation_accounts c WHERE c.owner_id=a.owner_id AND c.account_id=a.account_id)","EXISTS(SELECT 1 FROM live_automation_accounts c,json_each(c.body,'$.positions') p,json_each(p.value) h WHERE c.owner_id=a.owner_id AND c.account_id=a.account_id AND p.key=a.id AND CAST(json_extract(h.value,'$.quantity') AS REAL)<>0)");
  else conditions.push('1=1');
  if(tables.has('live_automation_orders'))conditions.push("EXISTS(SELECT 1 FROM live_automation_orders o WHERE o.owner_id=a.owner_id AND o.activation_id=a.id AND o.state NOT IN ('FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND'))");
  if(tables.has('live_event_runtime'))conditions.push("EXISTS(SELECT 1 FROM live_event_runtime r WHERE r.owner_id=a.owner_id AND r.activation_id=a.id AND ("+['providerPending','providerUnknown','pendingDecision'].map(key=>present("r.body,'$."+key+"'")).join(' OR ')+'))');
  checks.push({kind:'LIVE',query:'SELECT 1 FROM live_automation_activations a WHERE a.owner_id=?'+(profileId?" AND json_extract(a.body,'$.config.profileId')=?":'')+' AND ('+conditions.join(' OR ')+')',params:[owner,...(profileId?[profileId]:[])]});
 }
 if(tables.has('event_paper_subscriptions')){
  const conditions=["s.status NOT IN ('PAUSED','COMPLETED')",...['pending','unknown','incomplete','completedFrame'].map(key=>present("s.body,'$.runtime."+key+"'")),...['base.available','base.reserved','quote.reserved'].map(path=>"CAST(json_extract(s.state,'$.account.connector.balances."+path+"') AS REAL)<>0"),"EXISTS(SELECT 1 FROM json_each(s.state,'$.account.connector.orders') o WHERE json_extract(o.value,'$.status') NOT IN ('FILLED','CANCELLED','REJECTED'))"];
  checks.push({kind:'EVENT_PAPER',query:'SELECT 1 FROM event_paper_subscriptions s WHERE s.owner_id=?'+(profileId?' AND s.profile_id=?':'')+' AND ('+conditions.join(' OR ')+')',params:[owner,...(profileId?[profileId]:[])]});
  checks.push({kind:'EVENT_PAPER_STARTING',query:"SELECT 1 FROM workspace_objects w WHERE w.owner_id=? AND w.kind='mindPositions' AND json_extract(w.payload,'$.kind')='EVENT_PAPER_ALLOCATION' AND json_extract(w.payload,'$.releasedAt') IS NULL"+(profileId?" AND json_extract(w.payload,'$.profileId')=?":'')+" AND NOT EXISTS(SELECT 1 FROM event_paper_subscriptions s WHERE s.owner_id=w.owner_id AND json_extract(w.payload,'$.subscriptionId')=json_extract(s.body,'$.id'))",params:[owner,...(profileId?[profileId]:[])]});
 }
 if(requireReleasedAllocations)checks.push({kind:'EVENT_PAPER_ALLOCATION',query:"SELECT 1 FROM workspace_objects w WHERE w.owner_id=? AND w.kind='mindPositions' AND json_extract(w.payload,'$.kind')='EVENT_PAPER_ALLOCATION' AND json_extract(w.payload,'$.releasedAt') IS NULL",params:[owner]});
 const blocked=[];for(const item of checks)if(await db.prepare(item.query+' LIMIT 1').bind(...item.params).first())blocked.push(item.kind);
 // A newly created operational table between inspection and commit must also
 // reject the destructive write, rather than bypass an absent-table predicate.
 return {blocked,sql:checks.map(item=>' AND NOT EXISTS('+item.query+')').join('')+" AND (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ("+names.map(()=>'?').join(',')+'))=?',params:[...checks.flatMap(item=>item.params),...names,tables.size]};
}

/** Activation INSERT/RESUME is atomic with the active profile check. A trigger
 * failure rolls back the existing store's entire account/preview/activation batch. */
export async function ensureActiveProfileActivationFence(db,kind){
 if(!['LIVE','EVENT_PAPER'].includes(kind))throw new Error('Unsupported activation profile fence');
 const table=kind==='LIVE'?'live_automation_activations':'event_paper_subscriptions',prefix=kind==='LIVE'?'live':'event_paper',profile=kind==='LIVE'?"json_extract(NEW.body,'$.config.profileId')":'NEW.profile_id',active="EXISTS(SELECT 1 FROM workspace_objects p WHERE p.owner_id=NEW.owner_id AND p.kind='investmentProfiles' AND p.object_id="+profile+" AND COALESCE(json_extract(p.payload,'$.status'),'ACTIVE')='ACTIVE')";
 for(const [name,event,when]of [['insert','INSERT',"NEW.status='ENABLED'"],['resume','UPDATE OF status',"NEW.status='ENABLED' AND OLD.status<>'ENABLED'"]])await db.prepare('CREATE TRIGGER IF NOT EXISTS '+prefix+'_active_profile_'+name+' BEFORE '+event+' ON '+table+' WHEN '+when+' AND NOT '+active+" BEGIN SELECT RAISE(ABORT,'PROFILE_NOT_ACTIVE'); END").bind().run();
}
