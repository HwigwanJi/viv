import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {buildPortfolioReferenceValuation} from '../dist/domain/portfolio-reference-valuation.mjs';
import {portfolioDataset} from './portfolio-simulation-engine.mjs';
const check=(v,c,m,status=409)=>{if(!v)throw Object.assign(new Error(m),{code:c,status});};
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
async function referenceDataset(id,options){let bundle=options.portfolioReferenceDataset;if(!bundle){try{bundle=(await import('./data/cross-reference-bundle.json',{with:{type:'json'}})).default;}catch{check(false,'REFERENCE_DATASET_NOT_AVAILABLE','참고 평가 자료를 준비하고 있습니다.',404);}}check(!id||id===bundle.id,'REFERENCE_DATASET_NOT_AVAILABLE','저장된 참고 평가 자료를 선택하세요.',404);return bundle;}
export async function readPortfolioReferenceValuation({store,owner,id,priceDatasetId,options={}}){
 const head=await store.get(owner,id);check(head,'SIMULATION_NOT_FOUND','실험 보고서를 찾을 수 없습니다.',404);check(head.status==='COMPLETED'&&head.config.assetMode==='UPBIT_BTC_PORTFOLIO'&&head.report,'REFERENCE_REPORT_REQUIRED','완료한 BTC 포트폴리오 실험을 선택하세요.');
 const curve=await store.allRows(owner,id,'curve'),refs=curve.map(row=>({sequence:row.sequence,sha256:row.rowHash}));check(head.report.evidence?.rowCounts?.curve===curve.length&&head.report.evidence?.perKindSha256?.curve===researchSha256(JSON.stringify(refs)),'REFERENCE_CURVE_HASH','원 보고서의 전체 평가 행을 대조하세요.');
 return buildPortfolioReferenceValuation({report:head.report,curve,nativeBundle:portfolioDataset(head.config.datasetId,options),crossBundle:await referenceDataset(priceDatasetId,options)});
}
export async function handlePortfolioReferenceValuation(request,{store,owner,options}){
 const url=new URL(request.url),path=url.pathname.split('/reference-valuation')[1]??'',allowed=path==='/rows'?['id','priceDatasetId','cursor','pageSize']:['id','priceDatasetId'];check(request.method==='GET'&&['','/rows','/report'].includes(path),'REFERENCE_ROUTE','참고 평가 조회 경로를 확인하세요.',404);
 for(const key of url.searchParams.keys())check(allowed.includes(key)&&url.searchParams.getAll(key).length===1,'REFERENCE_QUERY','참고 평가 조회 조건을 확인하세요.',400);
 const id=url.searchParams.get('id');check(typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(id),'REFERENCE_QUERY','저장된 실험을 선택하세요.',400);
 const result=await readPortfolioReferenceValuation({store,owner,id,priceDatasetId:url.searchParams.get('priceDatasetId'),options}),{referenceValuation,curve,rows}=result;
 if(path==='/rows'){const size=url.searchParams.get('pageSize')??'100';check(/^[1-9]\d{0,2}$/.test(size)&&Number(size)<=200,'REFERENCE_PAGE_SIZE','한 페이지는 200개 이하로 조회하세요.',400);const limit=Number(size),scope=hashInputPackage({owner,id,referenceHash:referenceValuation.referenceHash,limit});let offset=0;if(url.searchParams.has('cursor')){let cursor;try{cursor=JSON.parse(atob(url.searchParams.get('cursor')));}catch{check(false,'REFERENCE_CURSOR','첫 페이지부터 다시 조회하세요.',400);}check(cursor.scope===scope&&Number.isSafeInteger(cursor.offset)&&cursor.offset>=0&&cursor.offset<=rows.length,'REFERENCE_CURSOR','조회 범위에 맞는 첫 페이지를 선택하세요.',400);offset=cursor.offset;}const items=rows.slice(offset,offset+limit),hasMore=offset+items.length<rows.length;return json({ok:true,referenceId:referenceValuation.id,referenceHash:referenceValuation.referenceHash,items,page:{pageSize:limit,hasMore,nextCursor:hasMore?btoa(JSON.stringify({scope,offset:offset+items.length})):null}});}
 if(path==='/report'){const text=JSON.stringify({schemaVersion:1,...result},null,2);return json({ok:true,reportId:referenceValuation.id,format:'json',hash:researchSha256(text),filename:referenceValuation.id+'.json',contentType:'application/json',text});}
 const stride=Math.max(1,Math.ceil(Math.max(0,curve.length-1)/398)),sample=curve.filter((_,i)=>i===0||i===curve.length-1||i%stride===0);return json({ok:true,referenceValuation,curve:sample,chart:{sourceCount:curve.length,shownCount:sample.length,method:'STORED_DAILY_REFERENCE_FIRST_LAST_V1'}});
}
