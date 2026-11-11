import {STRATEGY_NODE_TYPES} from './strategy-node-registry.mjs';

export const BROKER_CAPABILITY_VERSION='broker-node-contract-v1';
export const BROKER_CAPABILITIES=Object.freeze({
 toss:{id:'toss',label:'토스증권',marketKinds:['US_EQUITY','KR_EQUITY'],orders:['LIMIT_DAY','MARKET_DAY','LIMIT_CLS'],applicationExecutions:['PAPER'],clientOrderIdRetentionMs:600000,source:{url:'https://openapi.tossinvest.com/openapi-docs/latest/openapi.json',version:'1.2.24',checkedAt:'2026-10-21'}},
 upbit:{id:'upbit',label:'업비트',marketKinds:['CRYPTO'],orders:['LIMIT_FOK','LIMIT_IOC','LIMIT_GTC','LIMIT_DAY','MARKET_DAY'],applicationExecutions:['PAPER','ACCOUNT'],source:{url:'https://docs.upbit.com/kr/reference/new-order',implementation:'server/upbit-order-adapter.mjs'}},
});
export const BROKER_NODE_CONTRACTS=Object.freeze(STRATEGY_NODE_TYPES.map(type=>({type,role:type==='INPUT'?'MARKET_INPUT':type==='ORDER'?'BROKER_ORDER':['SESSION_RULE','SESSION_TREND','SESSION_SIGNAL'].includes(type)?'US_EQUITY_SESSION':'COMPUTATION'})));
export function inspectBrokerOrder({brokerId,marketKind,orderType,timeInForce='DAY'}){
 const broker=BROKER_CAPABILITIES[brokerId],capability=orderType+'_'+timeInForce;
 const supported=Boolean(broker?.marketKinds.includes(marketKind)&&broker.orders.includes(capability)&&!(capability==='LIMIT_CLS'&&marketKind!=='US_EQUITY'));
 return {contractVersion:BROKER_CAPABILITY_VERSION,brokerId,capability,supported,code:supported?null:'BROKER_ORDER_UNSUPPORTED',message:supported?'지원하는 주문 방식입니다.':`${broker?.label??brokerId}에서 지원하지 않는 주문입니다: ${marketKind} ${capability}`};
}
export function inspectBrokerNode(node,{brokerId,graph}={}){
 const broker=BROKER_CAPABILITIES[brokerId],order=graph?.nodes.find(n=>n.type==='ORDER'),adapted=order?.config.sessionOrderPolicy==='TOSS_LOC';
 let reason=null,origin='BROKER_CAPABILITY';
 if(!broker)reason='거래소 계약을 선택하세요.';
 else if(!STRATEGY_NODE_TYPES.includes(node.type))reason='등록된 노드 유형을 확인하세요.';
 else if(node.type==='INPUT'&&node.config.instrumentId&&node.config.instrumentId!=='execution:current'){
  const id=node.config.instrumentId,kind=id.startsWith('crypto:')?'CRYPTO':id.startsWith('equity:KRX:')?'KR_EQUITY':id.startsWith('equity:')?'US_EQUITY':null;
  if(kind&&!broker.marketKinds.includes(kind))reason='입력 종목의 시장을 지원하지 않습니다.';
 }else if(['SESSION_RULE','SESSION_TREND','SESSION_SIGNAL'].includes(node.type)){
  if(!broker.marketKinds.includes('US_EQUITY'))reason='미국 ETF 세션 계산이 필요합니다.';
  else if(node.type!=='SESSION_SIGNAL'&&!adapted)reason='생성 가능한 MOC 주문을 지원하지 않습니다. 주문 노드에서 토스 LOC 변환을 선택하세요.';
 }else if(node.type==='ORDER'){
  if(node.config.sizing==='SESSION_ORDERS'){
   if(brokerId!=='toss'||!adapted)reason='세션 주문의 LOC 변환 계약을 선택하세요.';
  }else if(!broker.orders.includes(node.config.orderType??'LIMIT_FOK'))reason='선택한 주문 체결 방식을 지원하지 않습니다.';
  if(!reason&&node.config.takeProfitBps&&!broker.orders.includes('LIMIT_GTC'))reason='매수 체결 후 유지되는 지정가 익절 주문을 지원하지 않습니다.';
  if(!reason&&!broker.applicationExecutions.includes(node.config.execution)){origin='APPLICATION_EXECUTOR';reason='이 앱의 실계좌 실행 연결이 구현되지 않았습니다.';}
 }
 const status=reason?'UNSUPPORTED':adapted&&['SESSION_RULE','SESSION_TREND'].includes(node.type)?'ADAPTED':'SUPPORTED';
 return {nodeId:node.id,type:node.type,brokerId,status,supported:!reason,origin,code:reason?(origin==='APPLICATION_EXECUTOR'?'BROKER_EXECUTOR_UNAVAILABLE':'BROKER_NODE_UNSUPPORTED'):null,message:reason?`${node.label??node.id}: ${origin==='APPLICATION_EXECUTOR'?'이 앱의 실행 연결을 확인하세요.':(broker?.label??brokerId)+'에서 지원하지 않는 노드입니다.'} ${reason}`:status==='ADAPTED'?'주문 노드의 토스 LOC 변환을 적용합니다.':'지원하는 노드입니다.'};
}
export function inspectGraphBrokerSupport(graph,{brokerId=graph.nodes.find(n=>n.type==='ORDER')?.config.brokerId}={}){
 if(!brokerId)return {contractVersion:BROKER_CAPABILITY_VERSION,brokerId:null,supported:true,nodes:[],issues:[]};
 const nodes=graph.nodes.map(node=>inspectBrokerNode(node,{brokerId,graph}));return {contractVersion:BROKER_CAPABILITY_VERSION,brokerId,supported:nodes.every(n=>n.supported),nodes,issues:nodes.filter(n=>!n.supported)};
}
