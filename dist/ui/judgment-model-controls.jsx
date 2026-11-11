import React,{useState} from 'react';
import {assertJudgmentModel} from '../domain/judgment-model.mjs';

export function JudgmentModelControls({data,expanded}){
 const [error,setError]=useState(''),m=data.node.config.model;
 async function load(event){const file=event.target.files?.[0];if(!file)return;try{if(file.size>180000)throw new Error('모델 파일은 180KB 이내로 선택하세요.');const model=JSON.parse(await file.text());assertJudgmentModel(model);data.onPatch(data.node,{config:{family:'OWN_STATE_VALUE_FOREST',model}});setError('');}catch(e){setError('모델 원문·학습 구간을 확인하세요. '+e.message);}finally{event.target.value='';}}
 if(!expanded)return <span className="strategy-inline-caption">{m?'자기 계좌 손익·하방 판단 · 학습 '+m.training.sampleCount+'개':'학습한 판단모델을 연결하세요'}</span>;
 return <section aria-label="수익 판단모델"><p>확정 시세와 자기 포지션으로 청산·20%·유지·60%의 예상 손익과 하방 위험을 비교합니다. {m?.contractVersion==='market-path-value-forest-v3'?'학습한 가격 경로에 현재 비중과 거래비용을 적용합니다.':'공개 체결의 행동 점수는 보조 관측이며 숨은 매매 의도를 뜻하지 않습니다.'}</p>
 <label className="field">학습 모델 가져오기<input type="file" accept=".json,application/json" aria-label="수익 판단모델 파일" disabled={data.saving} onChange={load}/></label>
 {m&&<><dl className="strategy-node-summary"><div><dt>학습 표본</dt><dd>{m.training.sampleCount}개</dd></div><div><dt>공개 상태</dt><dd>{m.training.publicStateCount}개</dd></div><div><dt>학습 종료 · UTC</dt><dd><time dateTime={m.training.lastLabelAt} title={m.training.lastLabelAt}>{m.training.lastLabelAt.slice(0,10)}<br/>{m.training.lastLabelAt.slice(11,19)} UTC</time></dd></div><div><dt>예측 기간</dt><dd>{m.horizonBars*4}시간</dd></div><div><dt>대상</dt><dd>BTC 현물</dd></div><div><dt>수수료 · 학습</dt><dd>{m.costs.feeBps}bp</dd></div><div><dt>슬리피지 · 학습</dt><dd>{m.costs.slippageBps}bp</dd></div></dl><p>과거 자료로 개발한 모의 연구 모델입니다. 수익성은 검증 결과를 확인하세요.</p></>}{error&&<p role="alert">{error}</p>}</section>;
}
