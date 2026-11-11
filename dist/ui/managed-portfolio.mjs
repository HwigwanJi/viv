import {callAutomation} from '../system/automation-contracts.mjs';
import {currencyAmount} from './currency-format.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderPortfolioReview(plan){
 const c=plan.target.config;
 return `<p>기존 ${plan.sources.length}개 자금 배정과 잔여 현금을 하나로 통합합니다.</p><dl class="live-change-values"><div><dt>전체 운용액</dt><dd>${esc(currencyAmount(Number(plan.total),'KRW',0))}원</dd></div><div><dt>운용 위임</dt><dd>시작 후 ${plan.durationDays}일</dd></div><div><dt>판단 주기</dt><dd>3시간</dd></div><div><dt>학습 자료</dt><dd>최근 7일 확정 시간봉</dd></div><div><dt>하루 손실 한도</dt><dd>${esc(currencyAmount(Number(c.dailyLossLimit),'KRW',0))}원</dd></div><div><dt>종목 범위</dt><dd>${c.marketIds.length}개 원화 마켓</dd></div></dl><p>추세, 돌파, 반등, BTC 보유, 현금의 학습 성과를 비교해 종목과 비중을 함께 조정합니다. 주문은 목표 비중과 실제 잔고를 대조해 매도 후 매수 순서로 실행됩니다.</p><p>위임 범위의 전략, 모델, 종목과 비중 변경은 AI 운용 엔진이 담당합니다. 기간 내 주기별 변경과 주문은 자동으로 실행됩니다.</p>`;
}
export function createManagedPortfolioControls({request,open,getWorkspace,onApplied,getDialogToken,isCurrent=()=>true,toast=()=>{}}){
 let busy=false,readJob=null;
 const send=(id,body)=>callAutomation(request,'automation.trading.portfolio.'+id,body);
 function mountForm(title,body,submitLabel,onSubmit){
  open(title,`<form data-portfolio-form>${body}<p data-portfolio-feedback role="status"></p><div class="form-actions"><button type="submit" class="button primary">${submitLabel}</button></div></form>`);
  const form=document.querySelector('[data-portfolio-form]');
  form?.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const b=form.querySelector('[type=submit]'),feedback=form.querySelector('[data-portfolio-feedback]');b.disabled=true;feedback.textContent='설정을 대조하고 있습니다.';try{await onSubmit(form);}catch(error){if(form.isConnected)feedback.textContent=error.message;}finally{busy=false;if(form.isConnected)b.disabled=false;}});
 }
 function review(plan){
  mountForm('통합 운용 확인',renderPortfolioReview(plan),'이 설정으로 통합 운용',async form=>{
   const {policy}=await send('activate',{previewId:plan.id,previewHash:plan.previewHash,nonce:plan.nonce,userAction:'LIVE_PORTFOLIO_ACTIVATION'});
   if(form.isConnected)open('통합 포트폴리오','<p role="status">통합 설정이 저장됐습니다. 운용 화면에서 첫 판단과 목표 비중을 확인할 수 있습니다.</p><p><a data-studio-route href="#minds?profileId='+esc(policy.config.profileId)+'&executionMode=live&view=operations">운용 상태 보기</a></p>');
   await onApplied?.();toast('통합 운용 설정을 반영했습니다.');
  });
 }
 const controls={async show(){
  if(busy||!isCurrent()||readJob?.current())return;
  open('통합 운용 확인','<p role="status">통합 운용 설정을 조회하고 있습니다.</p>');
  const token=getDialogToken?.(),current=()=>isCurrent()&&(token===undefined||token===getDialogToken?.()),job={current};readJob=job;
  try{
   const value=await request('/api/workspace/automated-trading'),policies=value.policies.filter(p=>p.status==='ENABLED'&&p.config.accountId==='upbit'&&p.config.quoteCurrency==='KRW');
   if(!current())return;
   if(!policies.length)throw Error('통합할 원화 운용을 확인하세요.');
   const managed=policies.find(p=>p.portfolioPlanId);if(managed){open('통합 포트폴리오','<p>전체 자금의 통합 운용이 설정돼 있습니다.</p><p><a data-studio-route href="#minds?profileId='+esc(managed.config.profileId)+'&executionMode=live&view=operations">운용 상태 보기</a></p>');return;}
   const saved=await send('read',{});if(!current())return;if(saved.portfolioPlan?.status==='PREPARED'){review(saved.portfolioPlan);return;}
   const first=policies.toSorted((a,b)=>b.config.marketIds.length-a.config.marketIds.length)[0],capital=await callAutomation(request,'automation.trading.capital.read',{activationId:first.id}),available=Number(capital.capital.exchangeAvailable),loss=Math.min(available,policies.reduce((s,p)=>s+Number(p.config.dailyLossLimit),0)),names=getWorkspace?.()?.investmentProfiles??[];
   if(!current())return;
   const name=p=>names.find(n=>n.id===p.config.profileId)?.name??p.config.profileId;
   mountForm('전체 계좌 통합 운용',`<p>${esc(policies.map(name).join(', '))}의 자금 배정을 통합합니다.</p><p>원화 잔고 ${esc(currencyAmount(available,'KRW',0))}원</p><label>운용 기록을 이어갈 마인드<select name="profileId">${policies.toSorted((a,b)=>a.id===first.id?-1:b.id===first.id?1:0).map(p=>'<option value="'+esc(p.config.profileId)+'">'+esc(name(p))+'</option>').join('')}</select></label><label>하루 손실 한도<input name="dailyLossLimit" inputmode="decimal" value="${esc(loss)}" required></label><p>최근 7일 자료로 3시간마다 공동 배분을 판단합니다. 현재 보유와 미확정 주문의 정산 상태를 함께 확인합니다.</p>`,'통합 설정 만들기',async form=>{
    const fields=new FormData(form),result=await send('prepare',{profileId:fields.get('profileId'),dailyLossLimit:fields.get('dailyLossLimit').trim()});if(form.isConnected)review(result.portfolioPlan);
   });
  }catch(error){if(current()){open('통합 운용 확인','<p role="alert">'+esc(error.message)+'</p><button type="button" class="button" data-portfolio-retry>다시 조회</button>');document.querySelector('[data-portfolio-retry]')?.addEventListener('click',()=>controls.show());}}finally{if(readJob===job)readJob=null;}
 }};
 return controls;
}
