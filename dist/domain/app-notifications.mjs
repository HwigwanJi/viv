const ID=/^[a-zA-Z0-9:_-]{1,160}$/;
export function notificationDismissalState(item){
 if(item?.deletedAt)return {allowed:false,reason:'휴지통에서 복원할 수 있습니다.'};
 // Dismissal only hides the notification; it never consumes its approval or changes its linked resource.
 if(['INFO','WAITING_EVIDENCE','APPROVAL_READY','COMPLETED','FAILED'].includes(item?.status))return {allowed:true,reason:''};
 return {allowed:false,reason:'알림을 다시 불러와 주세요.'};
}
export function notificationHref(id,profileId='all'){
 if(!ID.test(id))throw Error('NOTIFICATION_ID');
 return '/#minds?profileId='+encodeURIComponent(profileId)+'&executionMode=live&view=overview&notice='+encodeURIComponent(id);
}
export function validateAppNotification(value){
 if(!value||!ID.test(value.id)||typeof value.title!=='string'||!value.title.trim()||value.title.length>200||typeof value.body!=='string'||value.body.length>2000||!['INFO','WAITING_EVIDENCE','APPROVAL_READY','COMPLETED','FAILED'].includes(value.status)||!Number.isFinite(Date.parse(value.createdAt)))throw Error('NOTIFICATION_INPUT');
 if(value.details!==undefined&&(!Array.isArray(value.details)||value.details.length>30||value.details.some(r=>typeof r.label!=='string'||r.label.length>100||typeof r.value!=='string'||r.value.length>2000)))throw Error('NOTIFICATION_DETAILS');
 if(value.documentId!==undefined&&(typeof value.documentId!=='string'||!value.documentId||value.documentId.length>200))throw Error('NOTIFICATION_DOCUMENT');
 if(value.reportId!==undefined&&(typeof value.reportId!=='string'||!ID.test(value.reportId)))throw Error('NOTIFICATION_REPORT');
 let approval;
 if(value.approval!==undefined){const a=value.approval;if(!a||!['LIVE_ACTIVATION','LIVE_ALLOCATION'].includes(a.kind)||!ID.test(a.previewId??'')||typeof a.profileId!=='string'||!a.profileId||a.profileId.length>200||!/^[a-f0-9]{64}$/.test(a.previewHash??'')||Object.keys(a).some(k=>!['kind','previewId','previewHash','profileId'].includes(k)))throw Error('NOTIFICATION_APPROVAL_TARGET');approval={kind:a.kind,previewId:a.previewId,previewHash:a.previewHash,profileId:a.profileId};}
 if(value.status==='APPROVAL_READY'&&!approval)throw Error('NOTIFICATION_APPROVAL_TARGET');
 if(value.profileId!==undefined&&(typeof value.profileId!=='string'||!ID.test(value.profileId)))throw Error('NOTIFICATION_PROFILE');
 return {id:value.id,title:value.title,body:value.body,status:value.status,createdAt:new Date(value.createdAt).toISOString(),details:value.details??[],...(value.documentId?{documentId:value.documentId}:{}),...(value.reportId?{reportId:value.reportId}:{}),...(approval?{approval}:{}),...(value.profileId?{profileId:value.profileId}:{}),href:notificationHref(value.id,approval?.profileId??value.profileId??'all')};
}
