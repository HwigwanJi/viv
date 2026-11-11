import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHomePerformance} from '../server/home-performance.mjs';
import {renderHomeShowcase} from '../dist/ui/home-showcase.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';

test('paper home links to saved decisions and latest completed experiments independently of rankings',()=>{
  const at=hour=>`2026-11-11T${hour}:00:00.000Z`;
  const asOf=at('12');
  const run={profileId:'mind-a',experimentType:'FORWARD_PAPER',mode:'live',decisionAt:at('08'),decision:{action:'hold'},status:'COMPLETED'};
  const workspace={investmentProfiles:[{id:'mind-a',name:'추세형'}],mindRuns:[
    {...run,id:'mind-run-saved',decisionCompletedAt:at('10')},
    {...run,id:'mind-run-failed',decisionCompletedAt:at('11'),status:'FAILED'},
    {...run,id:'mind-run-replay',decisionCompletedAt:at('11'),mode:'replay'},
    {...run,id:'mind-run-future',decisionCompletedAt:at('13')},
  ]};
  const report=(simulationId,completedAt,metrics)=>{
    const body={simulationId,name:simulationId,completedAt,status:'COMPLETED',config:{mindId:'mind-a'},
      source:{synthetic:false},metrics,coverage:{warmupFrames:0,totalDecisionFrames:5,readyFrames:5}};
    return {report:{...body,reportHash:hashInputPackage(body)}};
  };
  const winner=report('simulation-winner',at('09'),{totalReturn:.1,maxDrawdown:.05,tradeCount:1});
  const latest=report('simulation-latest',at('11'),null);
  const performance=buildHomePerformance({workspace,simulationHighlights:[latest,winner],asOf});
  assert.equal(performance.latestPaperDecision.id,'mind-run-saved');
  assert.equal(performance.latestPaperExperiment.simulationId,'simulation-latest');
  assert.equal(performance.experimentBest.simulationId,'simulation-winner');
  const paper=renderHomeShowcase({performance},{params:new URLSearchParams()});
  assert.match(paper,/search=mind-run-saved[^"]*"[^>]*>[^]*?최근 모의 판단/);
  assert.match(paper,/simulationId=simulation-latest[^"]*"[^>]*>[^]*?최근 완료 실험/);
  const empty=renderHomeShowcase({performance:null},{params:new URLSearchParams()});
  assert.match(empty,/profileId=all[^"]*view=records[^"]*"[^>]*>[^]*?모의 판단 기록/);
  assert.match(empty,/profileId=all[^"]*view=simulations[^"]*"[^>]*>[^]*?백테스트 결과/);
  const live=buildHomePerformance({workspace,executionMode:'live',asOf});
  assert.equal(Object.hasOwn(live,'latestPaperDecision'),false);
  assert.doesNotMatch(renderHomeShowcase({performance:live},{params:new URLSearchParams('executionMode=live')}),/home-paper-results/);
});
