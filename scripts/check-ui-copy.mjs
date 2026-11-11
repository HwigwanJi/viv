import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Adapted from Keynes-wiki scripts/checks/ui_vocabulary.mjs at 08959a6.
// This app renders HTML templates; source quotations and saved notes are data owned by their authors.
export function visibleCopy(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const fragments = new Set();
  for (const m of text.matchAll(/>([^<>]*)</g)) {
    const value = m[1].replace(/\$\{[^{}]*\}/g, '…').trim();
    if (/[가-힣]/.test(value) && !/[;=()[\]]|&&|\|\|/.test(value)) fragments.add(value);
  }
  for (const pattern of [/(?:title|placeholder|aria-label)="([^"]*[가-힣][^"]*)"/g, /(?:label|title|subtitle|description|name)\s*:\s*['"]([^'"\n]*[가-힣][^'"\n]*)['"]/g, /[?:]\s*(['"])([^'"\n]*[가-힣][^'"\n]*)\1/g, /toast\(\s*(['"])([^'"\n]*[가-힣][^'"\n]*)\1/g]) {
    for (const m of text.matchAll(pattern)) fragments.add(m[2] || m[1]);
  }
  // Help is product copy too. Keep optional explanations under the same vocabulary rules.
  for(const call of text.matchAll(/help(?:Label|Tooltip)\(\s*(['"])((?:\\.|(?!\1)[^\r\n])*)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\r\n])*)\3/g)){
    fragments.add(call[2]);fragments.add(call[4]);
  }
  return [...fragments].filter(value => value.length > 1);
}
export function authoredCopy(source){
 const literals=/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1|`((?:\\.|[^`\\])*)`/g;
 return [...source.matchAll(literals)].map(m=>m[2]??m[3]??'').filter(text=>/[가-힣]/.test(text));
}
const contains = (text, word) => /^[A-Za-z]+$/.test(word) ? new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`).test(text) : text.includes(word);
export function inspectCopy(fragments, vocabulary) {
  const violations = [];
  for (const text of fragments) {
    for (const rule of vocabulary.쓰지않을말) {
      if (contains(text, rule.말) && !(rule.예외 || []).some(exception => text.includes(exception))) violations.push({ word: rule.말, text });
    }
    for (const word of vocabulary.investmentForbidden) if (contains(text, word)) violations.push({ word, text });
    for (const rule of vocabulary.쓰지않을어투) if (new RegExp(rule.본).test(text)) violations.push({ word: rule.규칙, text });
  }
  return violations;
}
export async function checkCopy() {
  const vocabulary = JSON.parse(await readFile(new URL('../design/vocabulary.json', import.meta.url), 'utf8'));
  if (vocabulary.쓰지않을말.length < 10 || vocabulary.쓰지않을어투.length < 2) throw new Error('Vocabulary contract is incomplete.');
  async function uiSources(directory){const files=[];for(const item of await readdir(new URL('../'+directory+'/',import.meta.url),{withFileTypes:true})){const file=directory+'/'+item.name;if(item.isDirectory()&&item.name!=='tokens')files.push(...await uiSources(file));else if(item.isFile()&&/\.(mjs|js|jsx)$/.test(file))files.push(file);}return files;}
  const uiFiles=await uiSources('dist/ui');
  const files = ['dist/index.html', 'dist/app.mjs', 'dist/strategy-view.mjs','dist/domain/strategy-node-guide.mjs',...uiFiles];
  let count = 0; const failures = [];
  const metaphorVocabulary={쓰지않을말:[],investmentForbidden:[],쓰지않을어투:vocabulary.쓰지않을어투.filter(rule=>rule.규칙==='기능을 흐리는 비유')};
  for (const file of files) { const source=await readFile(new URL('../' + file, import.meta.url), 'utf8'),fragments=visibleCopy(source); count += fragments.length; const found=[...inspectCopy(fragments, vocabulary),...inspectCopy(authoredCopy(source),metaphorVocabulary)];failures.push(...found.filter((v,i)=>found.findIndex(f=>f.word===v.word&&f.text===v.text)===i).map(v=>({file,...v}))); }
  if (count < 80) throw new Error('Copy extraction coverage fell below 80 fragments.');
  if (failures.length) { for (const v of failures) console.error(`${v.file}: ${v.word}: ${v.text.slice(0, 110)}`); throw new Error(`${failures.length} UI copy violations.`); }
  console.log(`UI vocabulary verified across ${count} rendered-copy fragments.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkCopy();
