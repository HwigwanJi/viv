import {liveChangeReview,renderLiveChangeReview} from '../../dist/ui/live-change-review.mjs';

const meta=document.querySelector('meta[name="control-token"]'),token=meta.content;meta.remove();
const button=document.querySelector('#update'),status=document.querySelector('#status'),open=document.querySelector('#open'),review=document.querySelector('#review');
let state,submitting=false,reviewKey=null;
async function request(path,body){const response=await fetch(new URL(path.slice(1),document.baseURI),{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),value=await response.json();if(!response.ok)throw Error(value.error??'서버 응답을 확인하세요.');return value;}
function render(value){
 state=value;const change=value.target?.strategyChange,done=['DONE','CURRENT'].includes(value.phase);
 const models=value.target?.strategyReviews?.length?value.target.strategyReviews:[value.target?.strategyReview??(change?liveChangeReview({name:change.modelName,after:change}):null)].filter(Boolean),key=JSON.stringify(models);
 if(key!==reviewKey){review.innerHTML=models.length?models.map(renderLiveChangeReview).join(''):'<p>현재 전략과 한도로 서버를 갱신합니다.</p>';reviewKey=key;}
 document.title=change?'운용 변경':'서버 갱신';document.querySelector('#heading').textContent=done?'운용 변경 완료':document.title;
 document.querySelector('#intro').textContent=done?'반영된 설정을 확인했습니다.':change?'변경 내용을 확인하고 적용합니다.':'현재 운용 설정으로 서버를 갱신합니다.';
 document.querySelector('#notice').textContent=done?'보유 자산과 거래 기록을 유지했습니다.':value.target?.resumeRequired?'서버가 중지돼 있습니다. 적용하면 갱신과 운용 재개를 이어갑니다.':change?'다음 판단부터 적용합니다. 보유 자산과 거래 기록을 유지합니다.':'보유 자산과 거래 기록을 유지합니다.';
 const labels={READY:'적용 대기',CURRENT:'최신 상태',DONE:'적용 완료',STOPPING:'진행 중인 처리 마무리',BACKUP:'원장 백업 중',STARTING:'서버 갱신 중',CHANGING:'변경 적용 중'};
 status.textContent=value.phase==='ERROR'?'적용 중 오류가 발생했습니다. 처리 상세를 확인하세요.':value.phase==='READY'&&value.target?.resumeRequired?'서버 갱신 대기':labels[value.phase]??value.message;status.dataset.phase=value.phase;
 document.querySelector('#technical-status').textContent=value.message;
 document.querySelector('#current').textContent=(value.result?.version??value.target?.version)?.replace('canonical-live-event-runner-','')??'확인 중';
 document.querySelector('#active').textContent=value.target?'활성 운용 '+value.target.activeCount+'개':'';
 document.querySelector('#change-step').hidden=!change;
 button.hidden=done;button.disabled=submitting||!['READY','ERROR'].includes(value.phase);button.textContent=value.phase==='ERROR'?'현재 상태 다시 확인':submitting?'적용 요청 중':'변경 적용';
 for(const item of document.querySelectorAll('li[data-phase]'))item.classList.toggle('active',item.dataset.phase===value.phase);
 const url=value.result?.appUrl??value.target?.appUrl;open.hidden=!done||!url;open.href=url??'#';open.classList.toggle('primary',done);
}
button.addEventListener('click',async()=>{
 if(submitting||!state?.target)return;submitting=true;button.disabled=true;
 try{if(state.phase==='ERROR')render(await request('/refresh'));else{await request('/update',{action:'UPDATE_AND_RESUME_CURRENT_SERVER',expected:state.target.fingerprint});await refresh();}}
 catch(error){status.textContent=error.message;}
 finally{submitting=false;button.disabled=!['READY','ERROR'].includes(state?.phase);}
});
async function refresh(){try{render(await request('/status'));}catch(error){status.textContent=error.message;button.disabled=true;}}
await refresh();setInterval(refresh,1000);
