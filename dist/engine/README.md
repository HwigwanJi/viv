# 모듈형 모의 투자 엔진

[투자 시스템 설계 정본](../../docs/system-spec.md)을 최우선 기준으로 사용한다. 이 문서는 v1 합성 데이터 연구 엔진의 계약을 보관한다. 현재 v2의 BTC·JEV·USDT 모의 운용은 `dist/trading/*`와 서버 API에서 처리한다.

이 v1 모듈은 브라우저와 Node에서 같은 ES module을 사용하며 `paper` 모드와 합성 입력을 허용한다. 자산 가격·현금·수수료·손익은 원화 기준이다.

## 빠른 사용

```js
import {
  getDemoMarket, createPortfolio, defaultStrategy, defaultRisk,
  evaluateCycle, executePaperOrder, runBacktest,
} from './engine/index.mjs';

const now = new Date().toISOString();
const market = getDemoMarket(now);
let portfolio = createPortfolio({ cash: 10_000_000, now });
const cycle = evaluateCycle({ market, portfolio, strategy: defaultStrategy,
  risk: defaultRisk, knowledge: [], now });

if (cycle.ok) {
  // 체결이 없어도 평가 시각과 일일 손실 기준을 유지한다.
  portfolio = cycle.portfolio;
  for (const proposal of cycle.proposals) {
    const result = executePaperOrder({ portfolio, proposal, market,
      risk: defaultRisk, now, clientOrderId: proposal.id });
    if (result.ok) portfolio = result.portfolio;
  }
}

const experiment = runBacktest({ strategy: defaultStrategy, risk: defaultRisk });
```

## 공개 API

| 함수 / 값 | 설명 |
| --- | --- |
| `getDemoMarket(now?)` | 지정 시각에 끝나는 100개 합성 일봉의 마지막 시장 스냅샷 |
| `getFixtureHistory({endAt?,bars?})` | 엄격히 정렬된 독립 스냅샷 배열. 기본 종료 시각은 고정된 `2026-01-01T00:00:00Z` |
| `defaultStrategy` | 평균 회귀 샘플. 20봉 평균, 진입 이탈 4%, 청산 이탈 1%, 목표 비중 18% |
| `listStrategies()` | 추세·평균 회귀·거래소 차이 연구 모듈의 설명과 각 기본 매개변수 |
| `registerStrategy(definition)` | `id`, `defaults`, `validate(parameters)`, `generate(asset, parameters)`를 갖는 순수 전략 등록 |
| `defaultRisk` | 아래 엔진 상한과 비용 설정 |
| `createPortfolio({cash?,positions?,now?})` | 새로운 모의 계정. 보유량은 심볼을 키로 하는 객체 |
| `evaluateCycle({market,portfolio,strategy?,risk?,knowledge?,now?})` | 시장·전략·회계 상태를 검증하고 신호·주문안·판정·평가 상태 반환 |
| `executePaperOrder({portfolio,proposal,market,risk?,now?,clientOrderId,mode?})` | 위험 한도를 다시 확인하고 새 계정 상태·체결·원장 반환 |
| `portfolioMetrics(portfolio,market)` | 평가액·현금·자산별 가치·실현/미실현 손익 |
| `runBacktest({strategy?,risk?,initialCash?,feeBps?,slippageBps?,history?})` | 과거부터 순차적으로 관측하고 다음 봉에서만 체결하는 동기 실험 |
| `compareStrategies({baseline?,candidate?,...backtestInput?})` | 같은 입력으로 기준·기회 집중 전략을 각각 실행하고 별도 실현손익 지표를 반환 |
| `listModules()` | UI에서 표시할 모듈 목록 |

`strategy`와 `risk`는 기본 객체를 복사한 뒤 수정한다. 위험 설정의 알 수 없는 키, 누락 필드, NaN/Infinity, 엔진 상한보다 느슨한 값은 거부한다. 전략별 매개변수는 `listStrategies()`의 `defaults`를 사용한다. 예를 들어 추세 전략은 `parameters:{shortWindow:5,longWindow:20,threshold:0.01}`이다.

## 주요 반환 구조

```js
// evaluateCycle
{
  ok, mode: 'paper', synthetic: true,
  marketAsOf, strategyId, market,
  portfolio, // 다음 평가/체결에 유지할 상태; 실패 시 없음
  signals: [{ symbol, action: 'buy' | 'sell' | 'hold', strength,
    code, reason, indicators, knowledgeRefs, verified: false }],
  proposals: [{ id, symbol, side: 'buy' | 'sell', quantity, marketAsOf,
    strategyId, targetWeight, estimatedPrice, estimatedGross,
    estimatedFee, estimatedSlippage, estimatedTotal, signalReason, mode: 'paper' }],
  decisions: [{ symbol, action, allowed, proposalId?, reasons: [{code,message}] }],
  reasons: [{code,message}],
  summary: { cash, equity, holdingsValue, realizedPnl, unrealizedPnl,
    totalPnl, dailyPnl, dailyLossRatio, feesPaid, slippagePaid,
    holdings, signalCount, proposalCount, blockedCount }
}

// executePaperOrder
{ ok, portfolio, execution?, metrics?, idempotent?, reasons: [{code,message}] }

// runBacktest
{
  ok, synthetic: true, mode: 'paper', initialEquity, finalEquity,
  totalReturn, totalReturnPct, maxDrawdown, maxDrawdownPct,
  tradeCount, feesPaid, slippagePaid,
  curve: [{at,equity,cash,drawdown,dailyPnl}],
  executions: [{at,decisionAt,symbol,side,quantity,fee,slippageCost,...}],
  blocked, portfolio, config, assumptions, unfilledSignals, reasons
}
```

비율은 `0.02 = 2%`, 수수료는 `10 bp = 0.1%`이다. `totalReturn`과 `maxDrawdown`은 비율이고, 끝에 `Pct`가 붙는 필드는 퍼센트 숫자다. 모든 인터페이스는 JSON으로 직렬화할 수 있다. 상태를 직접 수정하지 않고 반환된 새 객체를 사용한다.

## 강제 안전 필터

| 설정 | 기본 / 엔진 상한 | 작동 |
| --- | --- | --- |
| 1회 주문 | 순자산 10% / 10% | 매수는 비용 포함 금액, 매도는 기준 가격 금액 |
| 자산별 비중 | 순자산 25% / 25% | 체결 비용으로 줄어든 순자산까지 반영하여 매수 판정 |
| 일일 손실 | 2% / 2% | 원가 대신 시장 평가 손실 기준으로 신규 매수 차단, 제한 내 매도 허용 |
| 개별 보유 손실 | 4% / 5% | 추가 매수 차단, 전략 대상에서 제거한 보유량도 보호 매도 신호 생성 |
| 데이터 유효 시간 | 15분 / 15분 | 미래 시각, 오래된 시장 데이터, 불일치 가격 이력 거부 |
| 모의 비용 | 수수료 10 bp + 슬리피지 10 bp | 매수·매도에 모두 적용하며 원가·손익·현금에 반영 |

거래일은 한국 시각 기준이다. 새 거래일은 직전 평가액을 기준으로 하므로 밤사이 가격 하락을 지워버리지 않는다. `cycle.portfolio`를 보존하면 체결이 없는 시점도 직전 평가액에 기록된다.

보호 매도는 관측 시 생성하는 후보이며, 개별 손실을 4%로 제한한다고 보장하지 않는다. 1회 주문 한도에 따라 분할될 수 있고, 가격 갭과 관측 지연을 피할 수 없다. 실거래 전환은 현재 코드의 `mode` 값을 바꾸는 작업으로 지원하지 않는다.

같은 `clientOrderId`의 동일 주문은 기존 체결을 반환하며 추가 체결하지 않는다. 같은 ID에 다른 수량·자산·방향·관측 시각을 넣으면 `IDEMPOTENCY_CONFLICT`로 거부한다. 브라우저 상태는 로컬 모의 계정일 뿐 서버 권한이나 실거래 자산 보안을 제공하지 않는다.

## 전략과 지식의 경계

평균 회귀 아이디어는 2026-10-15 정원이형과의 대화에서 확인한 방향이다. 20봉·4%·1%·18% 등의 수치는 개발 단계의 샘플 매개변수다. 추세 전략은 비교용 샘플이다. 지식 항목은 `knowledgeRefs`로 신호와 원장에 연결한다. 전략·위험 한도 변경은 별도 설정과 검토로 처리한다.

`cross-venue-spread`는 국장/국내·해외 거래소 가격 차이를 살피자는 아이디어의 연구 자리다. 환율, 펀딩비, 차입/공매도, 결제, 동시 체결 모델이 없으므로 항상 `hold`와 `RESEARCH_ONLY_MISSING_EXECUTION_MODEL`을 반환한다. 기존 보유 손실에 대한 공통 보호 매도는 별도로 작동할 수 있다.

새 전략은 읽기 전용으로 복사한 자산과 매개변수를 받으며 `action`, 0~1의 `strength`, 문자열 `reason`/`code`, 유한수로 된 `indicators`를 반환한다. 예외나 잘못된 신호는 `hold`로 바뀐다. 전략의 주문안도 브로커의 모든 위험 검사를 통과해야 한다.

`clutch` 기회 집중 샘플은 선택 세 번째 인자의 불변 계좌 컨텍스트를 사용한다. 가격조건 충족도에 따라 `targetWeightFactor`(0 초과 1 이하)를 실제 목표 비중에 곱하고, 수익 중에만 증액하며 현재 보유 이후 관측 고점에서 추적청산 후보를 만든다. 기존 두 인자 플러그인은 호환된다. 선택 신호 필드 `regime`, `opportunityScore`, `targetWeightFactor`도 허용 목록으로 검사한다. 공식·기본값·이력 제한·비교 지표는 개발 단계의 가설이며 [기회 집중 설계](../../docs/clutch-strategy.md)에 명시했다. BTC 명세서의 9장 계산 기준은 v2 가격 모델에서 관리한다.

## 순차 실험의 한계

합성 일봉 t의 종가를 관측하고 t+1의 종가에서 비용을 적용하여 모의 체결한다. 체결 전 최신 가격과 위험 한도를 다시 확인한다. 마지막 봉의 신호는 체결하지 않는다. 미래 봉 삽입, 역순 이력, 이미 본 과거 가격의 수정은 거부한다. 결과를 실제 성과·실시간 수익·미래 수익의 예측으로 해석하면 안 된다.

현재 모델은 유동성, 장중 경로, 휴장일/거래 시간, 주식 세금, 배당, 기업행사, 환율, 차입/공매도, 펀딩을 계산하지 않는다. 향후 브로커·시장·비용 어댑터를 추가할 때 별도 검증해야 한다.

## 검증

프로젝트 루트에서 `node --test tests/engine.test.mjs`를 실행한다. 엔진 한도, 계정 회계, 지연 체결, 미래 데이터 오염, 재실행 중복 체결을 검증한다.
