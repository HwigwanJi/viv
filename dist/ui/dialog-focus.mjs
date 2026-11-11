const controlSelector='button,a[href],input,textarea,select,[role="button"],[role="link"],[tabindex]';
const identityKeys=['appNotifications','studioAction','studioId','terminalAction','terminalId','terminalOwner','libraryAction','libraryId','strategyLibraryAction','strategyLibraryId','simulationAction','simulationId','labAction','labId','brokerAction','brokerProvider','companionAction','studioProfileId','profileId'];
const role=node=>node?.getAttribute?.('role')||({BUTTON:'button',A:'link',INPUT:'input',TEXTAREA:'textbox',SELECT:'combobox'})[node?.tagName]||node?.tagName;
const usable=node=>!!node?.isConnected&&!node.disabled&&node.getAttribute?.('aria-disabled')!=='true'&&!node.closest?.('[inert]')&&typeof node.focus==='function'&&!!node.getClientRects?.().length;
const label=node=>node?.getAttribute?.('aria-label')||node?.textContent?.trim()||'';
function identity(node){const latestOfOwner=node?.dataset?.terminalAction==='decision'&&node.dataset.terminalOwner;return {role:role(node),keys:Object.fromEntries(identityKeys.filter(key=>Object.hasOwn(node?.dataset??{},key)&&!(latestOfOwner&&key==='terminalId')).map(key=>[key,node.dataset[key]])),id:node?.id||null,href:node?.getAttribute?.('href')||null,label:label(node)};}
function sameIdentity(node,value){
  if(role(node)!==value.role)return false;
  const keys=Object.keys(value.keys);
  if(keys.length)return keys.every(key=>node.dataset?.[key]===value.keys[key]);
  if(value.id)return node.id===value.id;
  if(value.href)return node.getAttribute?.('href')===value.href;
  return !!value.label&&label(node)===value.label;
}

/** The app has one modal host. Replacing its contents retains the first
 * external opener; internal modal controls never become the return target. */
export function createDialogFocusController({getDialog,getContainer,getActiveElement,restoreFallback=()=>false}){
  let origin=null,remembered=null,restored=false,restoreAfterRender=false;
  function external(node){const dialog=getDialog(),container=getContainer();return node&&container?.contains?.(node)&&!dialog?.contains?.(node);}
  function rememberInteraction(target){
    const node=target?.closest?.(controlSelector);
    if(external(node)&&usable(node))remembered={node,identity:identity(node)};
  }
  function beforeOpen({replaceOrigin=false}={}){
    if(getDialog()?.open&&!replaceOrigin)return;
    const active=getActiveElement(),candidate=active?.closest?.(controlSelector),node=/^H[1-6]$/.test(candidate?.tagName??'')?null:candidate;
    origin=external(node)&&usable(node)?{node,identity:identity(node)}:remembered;
    restored=false;
  }
  function focusCurrent(){
    const dialog=getDialog();
    if(!dialog?.open||dialog.dataset?.readerDocked==='true'||dialog.contains(getActiveElement()))return false;
    const target=dialog.querySelector?.('[data-studio-action="close-dialog"]');
    if(!usable(target))return false;
    target.focus({preventScroll:true});return true;
  }
  function restore(){
    if(getDialog()?.open||restored)return false;
    restored=true;
    const container=getContainer();
    if(origin){
      if(external(origin.node)&&usable(origin.node)){origin.node.focus({preventScroll:true});return true;}
      const matches=[...container?.querySelectorAll?.(controlSelector)||[]].filter(node=>usable(node)&&sameIdentity(node,origin.identity));
      const target=matches.find(node=>label(node)===origin.identity.label)||matches[0];
      if(target){target.focus({preventScroll:true});return true;}
      if(restoreFallback(origin.node,container))return true;
    }
    const heading=[...container?.querySelectorAll?.('main .content h1,main h1')||[]].find(usable);
    if(!heading)return false;
    if(!heading.hasAttribute('tabindex'))heading.setAttribute('tabindex','-1');
    heading.focus({preventScroll:true});return true;
  }
  function beforeRender({sameRoute=true}={}){
    const active=getActiveElement();
    if(!sameRoute||!restored||getDialog()?.open||!origin){restoreAfterRender=false;return;}
    if(!active||active.tagName==='BODY')return;
    restoreAfterRender=Boolean(external(active)&&usable(active)&&sameIdentity(active,origin.identity));
  }
  function afterRender(){
    const pending=restoreAfterRender;restoreAfterRender=false;const active=getActiveElement();
    if(!pending||getDialog()?.open||active&&active.tagName!=='BODY')return false;
    restored=false;return restore();
  }
  return {rememberInteraction,beforeOpen,focusCurrent,restore,beforeRender,afterRender};
}

export function revealDialogError(node,message,{focus=true}={}){
  if(!node)return false;
  node.textContent=message;
  if(focus){node.focus?.();node.scrollIntoView?.({block:'nearest'});}
  return true;
}
