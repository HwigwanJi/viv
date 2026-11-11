import {gzipSync,gunzipSync} from 'node:zlib';
import {researchSha256} from '../dist/domain/research.mjs';
const ENCODING='CJI_EVENT_GZIP_UTF8_V1';
function index(body){const evaluation=body.evaluation??body.plan?.evaluation,frame=body.frame;return {
 ...(body.policyRef?{policyRef:body.policyRef}:{}),...(body.snapshotAsOf?{snapshotAsOf:body.snapshotAsOf}:{}),...(body.inputHash?{inputHash:body.inputHash}:{}),...(body.programMember?{programMember:body.programMember}:{}),
 ...(evaluation?{evaluation:{graphHash:evaluation.graphHash,asOf:evaluation.asOf,outputHash:evaluation.outputHash,output:evaluation.output}}:{}),
 ...(frame?{frame:{asOf:frame.asOf,availableAt:frame.availableAt,timeframe:frame.timeframe,series:frame.series.map(s=>({market:s.market})),sourceRefs:frame.sourceRefs,...(frame.watch?{watch:{observedMarkets:frame.watch.observedMarkets}}:{}),...(frame.news?{news:frame.news}:{})}}:{})};}
/** Index fields stay queryable; the complete original body and its hash are losslessly retained. */
export function encodeLiveEventBody(body){
 const evaluation=body.evaluation??body.plan?.evaluation,minute=body.frame?.contractVersion==='minute-surge-market-v1'||evaluation?.trace?.some(n=>n.type==='MODEL'&&n.output?.modelReview),raw=JSON.stringify(body);
 if(!minute||Buffer.byteLength(raw)<8000)return raw;
 return JSON.stringify({...index(body),contentEncoding:ENCODING,bodySha256:researchSha256(raw),bodyGzipBase64:gzipSync(Buffer.from(raw)).toString('base64')});
}
export function decodeLiveEventBody(value){
 const body=typeof value==='string'?JSON.parse(value):value;if(body?.contentEncoding!==ENCODING)return body;
 const raw=gunzipSync(Buffer.from(body.bodyGzipBase64,'base64'),{maxOutputLength:8000000}).toString('utf8');if(researchSha256(raw)!==body.bodySha256)throw Error('LIVE_EVENT_BODY_HASH');
 const original=JSON.parse(raw),{contentEncoding,bodySha256,bodyGzipBase64,...indexed}=body;if(JSON.stringify(index(original))!==JSON.stringify(indexed))throw Error('LIVE_EVENT_INDEX_HASH');return original;
}
