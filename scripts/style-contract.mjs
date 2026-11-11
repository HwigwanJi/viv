import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

export const VENDOR_STYLES=['dist/vendor/strategy-graph-editor.css'];
function inspectImports(ast,filename){const problems=[];ast.walkAtRules(rule=>{if(!['import','reference'].includes(rule.name))return;const target=/^["']([^"']+)["']/.exec(rule.params)?.[1];if(['tailwindcss','tailwindcss/theme.css','tailwindcss/preflight.css','tailwindcss/utilities.css'].includes(target))return;const resolved=target?path.posix.normalize(path.posix.join(path.posix.dirname(filename),target)):'';if(!target||!target.startsWith('.')||!(/^(?:styles\/|dist\/ui\/tokens\/)/.test(resolved)))problems.push({file:filename,line:rule.source.start.line,code:'NON_CANONICAL_STYLE_IMPORT',value:rule.params});});return problems;}
export async function authoredStyleFiles(root,relative){
 const files=[];
 for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
  const file=relative+'/'+item.name;
  if(item.isSymbolicLink())throw new Error('Style source cannot be a symbolic link: '+file);
  if(item.isDirectory()&&!['vendor','server','assets','icons'].includes(item.name))files.push(...await authoredStyleFiles(root,file));
  else if(item.isFile())files.push(file);
 }
 return files.sort();
}
export function inspectComponentStyles(source,filename='component.css'){
 const ast=postcss.parse(source,{from:filename}),violations=inspectImports(ast,filename);let apply=0;
 ast.walkAtRules(rule=>{
  if(rule.name==='apply'){apply++;if(/\[[^\]]*(?:\d|#[a-f\d]{3,8}\b|(?:rgb|hsl|oklch)\()[^\]]*\]/i.test(rule.params))violations.push({file:filename,line:rule.source.start.line,code:'ARBITRARY_UTILITY',value:rule.params});}
  if(rule.name==='media'&&/\d+(?:px|rem|em)/.test(rule.params))violations.push({file:filename,line:rule.source.start.line,code:'LITERAL_BREAKPOINT',value:rule.params});
 });
 ast.walkDecls(decl=>{
  const value=decl.value.replace(/var\(\s*--[\w-]+\s*\)/g,'TOKEN');
  const item={file:filename,line:decl.source.start.line,property:decl.prop,value:decl.value};
  if(/(?:^|[^\w-])(?:\d*\.)?\d+(?:px|r?em|[sd]?vh|[sd]?vw|vmin|vmax|ch|ex|ms|s|deg)\b/i.test(value)||/#[a-f\d]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i.test(value))violations.push({...item,code:'LITERAL_VISUAL_VALUE'});
  if(['font-size','font-weight','line-height','opacity','z-index'].includes(decl.prop)&&/^[+-]?(?:\d*\.)?\d+$/.test(value)&&!['0','1'].includes(value))violations.push({...item,code:'LITERAL_VISUAL_NUMBER'});
  let keyframe=false;for(let p=decl.parent;p;p=p.parent)if(p.type==='atrule'&&p.name.endsWith('keyframes'))keyframe=true;
  if(!keyframe&&/^(?:padding|margin|gap|row-gap|column-gap)(?:-|$)/.test(decl.prop))violations.push({...item,code:'TAILWIND_SPACING_REQUIRED'});
 });
 if(!apply)violations.push({file:filename,code:'TAILWIND_UTILITIES_REQUIRED'});
 return violations;
}
export function inspectTokenStyles(source,filename){
 const ast=postcss.parse(source,{from:filename}),problems=inspectImports(ast,filename);
 ast.walkAtRules('media',rule=>{if(/\d+(?:px|rem|em)/.test(rule.params))problems.push({file:filename,line:rule.source.start.line,code:'LITERAL_BREAKPOINT',value:rule.params});});
 ast.walkDecls(decl=>{if(decl.prop.startsWith('--')||decl.prop==='color-scheme')return;let definition=false;for(let parent=decl.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&(parent.name.endsWith('keyframes')||['font-face','utility'].includes(parent.name)))definition=true;
  if(!definition)problems.push({file:filename,line:decl.source.start.line,code:'TOKEN_LAYER_CONTAINS_COMPONENT_RULE',property:decl.prop});
  else if(/\d+(?:px|rem|em|deg|ms)\b|#[a-f\d]{3,8}/i.test(decl.value))problems.push({file:filename,line:decl.source.start.line,code:'TOKENIZED_DEFINITION_REQUIRED',property:decl.prop,value:decl.value});
 });return problems;
}
const dynamicProperties=new Set(['width','height','left','right','top','bottom','max-height','max-width']);
const measuredDomProperties=new Set(['width','height','left','right','top','bottom','maxHeight','maxWidth','overflow']);
export function inspectInlineStyles(source,filename){
 const problems=[],add=(code,value)=>problems.push({file:filename,code,value});
 if(/<style\b/i.test(source))add('INLINE_STYLESHEET_FORBIDDEN','Move authored rules into styles/components.');
 if(/createElement\(\s*['"]style['"]\s*\)|\bnew\s+CSSStyleSheet\s*\(|\.insertRule\s*\(/.test(source))add('RUNTIME_STYLESHEET_FORBIDDEN','Use the canonical Tailwind build.');
 for(const match of source.matchAll(/\b(?:(?:min-|max-)?[wh]|[pm][trblxyse]?|gap(?:-[xy])?|text|bg|border(?:-[trblxy])?|rounded(?:-[trbl])?|top|right|bottom|left|inset|z|opacity|shadow|leading|tracking|duration|delay|translate-[xy]|scale)-\[([^\]\r\n]+)\]/g))if(/\d|#[a-f\d]{3,8}\b|\b(?:rgb|hsl|oklch)\(/i.test(match[1]))add('ARBITRARY_UTILITY',match[0]);
 for(const match of source.matchAll(/\[(?:padding|margin|width|height|color|background|--[\w-]+):[^\]\r\n]+\]/g))if(/\d|#[a-f\d]{3,8}/i.test(match[0]))add('ARBITRARY_UTILITY',match[0]);
 for(const match of source.matchAll(/<[A-Za-z][^<>]*?\sstyle\s*=\s*(["'])([\s\S]*?)\1/g)){
  for(const field of match[2].split(';').filter(s=>s.trim())){const i=field.indexOf(':'),property=field.slice(0,i).trim(),value=field.slice(i+1).trim();
   // Viewport coordinates, chart selections and data meters are measured at runtime.
   if((property.startsWith('--')||dynamicProperties.has(property))&&/\$\{(?!\s*[\d.]+\s*\})/.test(value)&&!/(?:\d|#)[\w.]*?(?:px|rem|em)\b|#[a-f\d]{3,8}/i.test(value))continue;
   add('INLINE_VISUAL_STYLE_FORBIDDEN',field);
  }
 }
 for(const match of source.matchAll(/\.style\.(\w+)\s*=\s*(['"])([^'"\r\n]*)\2/g))if(match[1]!=='overflow'&&/\d+(?:px|rem|em|vh|vw)|#[a-f\d]{3,8}/i.test(match[3]))add('STATIC_DOM_STYLE_FORBIDDEN',match[0]);
 for(const match of source.matchAll(/\.style\.(\w+)\s*=/g))if(!measuredDomProperties.has(match[1]))add('COMPONENT_DOM_STYLE_FORBIDDEN',match[0]);
 for(const match of source.matchAll(/\.style\.setProperty\(\s*(['"])([^'"\r\n]+)\1/g))if(!match[2].startsWith('--'))add('COMPONENT_DOM_STYLE_FORBIDDEN',match[0]);
 for(const match of source.matchAll(/style\s*=\s*\{\{([\s\S]*?)\}\}/g))for(const field of match[1].matchAll(/(?:^|,)\s*(?:['"]([^'"]+)['"]|(\w+))\s*:\s*(['"]?)([^,}]+)\3/g))if(!(field[1]||field[2]).startsWith('--')&&/^['"]?\d+(?:px|rem|em|vh|vw)?['"]?$/.test(field[4].trim()))add('STATIC_JSX_STYLE_FORBIDDEN',field[0]);
 return problems;
}
export function inspectPageStyles(source,file,outputs){
 const problems=inspectInlineStyles(source,file),known=new Set(outputs.map(([,name])=>name)),links=[];
 for(const match of source.matchAll(/<link\b[^>]*>/gi)){
  if(!/\brel\s*=\s*['"]stylesheet['"]/i.test(match[0]))continue;
  const href=/\bhref\s*=\s*['"]([^'"]+)['"]/i.exec(match[0])?.[1];if(!href)continue;
  if(/^(?:https?:|\/\/|data:)/.test(href)){problems.push({file,code:'UNREGISTERED_STYLESHEET',value:href});continue;}
  const target=href.startsWith('/')?'dist/'+href.slice(1).split(/[?#]/)[0]:path.posix.normalize(path.posix.join(path.posix.dirname(file),href.split(/[?#]/)[0]));links.push(target);
  if(!known.has(target)&&!VENDOR_STYLES.includes(target))problems.push({file,code:'UNREGISTERED_STYLESHEET',value:href});
 }
 if(links.filter(p=>p==='dist/ui/tailwind.css').length!==1)problems.push({file,code:'PAGE_TAILWIND_REQUIRED'});
 for(const target of new Set(links))if(links.filter(p=>p===target).length>1)problems.push({file,code:'DUPLICATE_STYLESHEET',value:target});
 if(!links.some(p=>known.has(p)&&p!=='dist/ui/tailwind.css'))problems.push({file,code:'PAGE_COMPONENT_STYLES_REQUIRED'});
 return {problems,links};
}
export async function inspectStyleSources({rootDir,outputs}){
 const problems=[],pages=[],components=[];
 for(const file of await authoredStyleFiles(rootDir,'styles/components'))if(file.endsWith('.css')){components.push(file);problems.push(...inspectComponentStyles(await readFile(path.join(rootDir,file),'utf8'),file));}
 for(const file of [...await authoredStyleFiles(rootDir,'styles'),...await authoredStyleFiles(rootDir,'dist/ui/tokens')]){if(!file.endsWith('.css')||file.startsWith('styles/components/'))continue;if(file==='styles/theme.css'||/^(?:styles\/tokens|dist\/ui\/tokens)\//.test(file))problems.push(...inspectTokenStyles(await readFile(path.join(rootDir,file),'utf8'),file));else problems.push({file,code:'UNREGISTERED_STYLE_SOURCE'});}
 for(const file of await authoredStyleFiles(rootDir,'dist')){
  if(file.endsWith('.html')){const source=await readFile(path.join(rootDir,file),'utf8'),result=inspectPageStyles(source,file,outputs);pages.push({path:file,stylesheets:result.links,system:result.problems.length?'LEGACY_OR_MIXED':'TAILWIND'});problems.push(...result.problems);}
  else if(/^dist\/(?:ui\/)?[^/]+\.(mjs|jsx)$/.test(file))problems.push(...inspectInlineStyles(await readFile(path.join(rootDir,file),'utf8'),file));
  if(file.endsWith('.css')&&!file.startsWith('dist/ui/tokens/')&&!outputs.some(([,p])=>p===file))problems.push({file,code:'UNREGISTERED_CSS_OUTPUT'});
 }
 for(const file of VENDOR_STYLES)try{if((await lstat(path.join(rootDir,file))).isSymbolicLink())problems.push({file,code:'INVALID_VENDOR_STYLE'});}catch(error){if(error.code!=='ENOENT')throw error;}
 return {problems,pages,components};
}
