import test from 'node:test';
import assert from 'node:assert/strict';
import {currentPaperQuote} from '../server/mind-execution-service.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';

test('quote failure names the action the user can retry',async()=>{
 const instrument=getInstrument('crypto:okx:BTC-USDT');
 const fetchImpl=async()=>{throw new Error('disconnected');};
 await Promise.all([
  assert.rejects(currentPaperQuote(instrument,{fetchImpl,action:'hold'}),
   error=>error.code==='EXECUTION_QUOTE_UNAVAILABLE'&&error.message.includes('후속 관측 기준을 다시 저장')),
  assert.rejects(currentPaperQuote(instrument,{fetchImpl,action:'buy'}),
   error=>error.code==='EXECUTION_QUOTE_UNAVAILABLE'&&error.message.includes('모의 체결을 다시 실행')),
 ]);
});
