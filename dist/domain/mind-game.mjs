export const MIND_CHARACTERS=Object.freeze([
 {id:'blob',name:'물방울',rhythm:0}, {id:'pear',name:'둥근 배',rhythm:1},
 {id:'heart',name:'하트',rhythm:2}, {id:'frog',name:'개구리',rhythm:3},
 {id:'cat',name:'고양이',rhythm:4}, {id:'rabbit',name:'토끼',rhythm:5},
]);
export const MIND_MOTIONS=Object.freeze([
 {id:'rest',name:'쉬기'}, {id:'idle',name:'대기'}, {id:'scan',name:'종목 탐색'},
 {id:'think',name:'AI 판단'}, {id:'entry',name:'진입 주문'}, {id:'hold',name:'보유 관찰'},
 {id:'add',name:'추가 진입'}, {id:'reduce',name:'비중 축소'}, {id:'exit',name:'청산 주문'},
 {id:'settle',name:'수익 정산'}, {id:'attention',name:'상태 점검'}, {id:'stale',name:'연결 확인'},
]);
const S=10n**18n;
export function gameUnits(value){
 const text=typeof value==='number'&&Number.isFinite(value)?value.toFixed(18):String(value);
 if(!/^-?\d+(?:\.\d{1,18})?$/.test(text))throw new TypeError('손익 원장 금액을 확인하세요.');
 const negative=text.startsWith('-'),[whole,part='']=(negative?text.slice(1):text).split('.');
 return (negative?-1n:1n)*(BigInt(whole)*S+BigInt(part.padEnd(18,'0')));
}
export function gameDecimal(value){const sign=value<0n?'-':'',n=value<0n?-value:value,f=(n%S).toString().padStart(18,'0').replace(/0+$/,'');return sign+(n/S)+(f?'.'+f:'');}
export const koreaDay=at=>new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10);

export function projectMindGame({ledger=[],currency,asOf,expectedRealized=null,equity=null,valuationAsOf=null}={}){
 const day=koreaDay(asOf),seen=new Set();let total=0n,today=0n;const receipts=[];
 for(const row of ledger){
  const at=row.at,id=row.exchangeTradeId??row.runId??row.fillId;
  if(!id||seen.has(id)||!Number.isFinite(Date.parse(at))||at>asOf)throw new TypeError('체결 ID와 시각을 확인하세요.');
  seen.add(id);const pnl=gameUnits(row.exactRealizedPnl??row.realizedPnl);total+=pnl;
  if(koreaDay(at)===day){today+=pnl;if(row.side==='sell')receipts.push({id:String(id),at,amount:gameDecimal(pnl),currency,instrumentId:row.instrumentId,orderId:row.exchangeOrderIdentifier??row.orderId??null});}
 }
 if(expectedRealized!==null&&total!==gameUnits(expectedRealized))throw new TypeError('체결별 손익과 합계 원장을 대조하세요.');
 return {status:'READY',day,timeZone:'Asia/Seoul',basis:'REALIZED_AFTER_FEES',currency,todayRealizedPnl:gameDecimal(today),equity:equity===null?null:gameDecimal(gameUnits(equity)),valuationAsOf,asOf,settlements:receipts.sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id)).slice(0,200)};
}

export function mindMotion(card,asOf){
 const activity=card.liveActivity??card.paperActivity,runtime=activity?.runtime??{};
 if(card.automation?.requiresAttention||runtime.errorCode||card.phase==='attention')return 'attention';
 if(runtime.hostStatus==='DISABLED'||['PAUSED','COMPLETED','STOPPED'].includes(activity?.status)||card.phase==='sleep')return 'rest';
 if(activity&&runtime.updatedAt&&Date.parse(asOf)-Date.parse(runtime.updatedAt)>120000)return 'stale';
 if(runtime.providerState==='IN_FLIGHT'||runtime.state==='JEV_STARTED')return 'think';
 const order=(activity?.recentActivity??[]).find(r=>r.kind==='STRATEGY_ORDER'&&['RESERVED','PENDING','PARTIALLY_FILLED','UNKNOWN','RECONCILIATION_REQUIRED'].includes(r.state));
 if(order)return order.action==='sell'?(order.intent==='REDUCE'?'reduce':'exit'):order.intent==='ADD'?'add':'entry';
 if(card.holdings?.hasHoldings)return 'hold';
 return card.automation?.enabled?'scan':'idle';
}
export function cardGame(card,{workspace={},asOf}={}){
 let game=(card.liveActivity??card.paperActivity)?.gamification;
 if(!game&&card.executionMode==='paper'){
  const accounts=(workspace.mindPositions??[]).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===card.profileId);
  const currencies=[...new Set(accounts.map(a=>a.quoteCurrency))];
  if(currencies.length===1)try{game=projectMindGame({ledger:accounts.flatMap(a=>(a.ledger??[]).map(r=>({...r,runId:a.id+':'+(r.exchangeTradeId??r.runId)}))),currency:currencies[0],asOf});}catch{}
 }
 const current=game?.status==='READY'&&game.day===koreaDay(asOf),pnl=current?gameUnits(game.todayRealizedPnl):null;
 return {motion:mindMotion(card,asOf),weather:pnl===null?'unknown':pnl>0n?'sunny':pnl<0n?'rainy':'calm',day:koreaDay(asOf),...(current?game:{status:'DATA_REQUIRED',todayRealizedPnl:null,settlements:[],currency:game?.currency??card.currencies?.[0]?.currency??card.liveActivity?.quoteCurrency??null})};
}
