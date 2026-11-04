const API='https://mmfsavdfiskhvypkrjnb.supabase.co';
const KEY='sb_publishable_L29n6t4Rw-_THcwQQRBNaw_5D78IwDK';
const STORAGE='awaken-auth-v1';
const $=id=>document.getElementById(id);
let session=null,target=null,busy=false,revision=0,refreshing=null;
let authEpoch=0,listRevision=0,listBusy=false,listRows=[];
const listState={filter:'all',search:'',page:1,pageSize:25,total:0};
const messages={preregistered:'事前登録・初回認証待ち',trial_ready:'無料体験・未使用',trial_used:'無料体験・利用済み',subscriber_ready:'会員・今すぐ利用可能',subscriber_waiting:'会員・次回利用待ち',expired:'会員資格終了',disabled:'利用停止中'};
function date(value){return value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+'（日本時間）':'—';}
function deny(message){authEpoch++;listRevision++;listBusy=false;clearList();$('preregister-email').value='';$('preregister-message').textContent='';$('customer-email').value='';$('list-email').value='';for(const id of ['result-email','member-state','email-confirmed','next-draw','last-draw','end-source','end-date'])$(id).textContent='';revision++;target=null;$('manager').hidden=true;$('customer').hidden=true;$('gate').hidden=false;$('gate-message').textContent=message;}
async function call(path,{body,token,method='POST'}={}){
 const response=await fetch(API+path,{method,headers:{apikey:KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const error=new Error(data?.message||data?.msg||'REQUEST_FAILED');error.status=response.status;error.code=data?.code;throw error;}return data;
}
async function token(){
 if(!session)throw new Error('LOGIN_REQUIRED');
 if(session.expires_at*1000>Date.now()+60000)return session.access_token;
 if(!refreshing)refreshing=call('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}}).then(data=>{session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in};try{localStorage.setItem(STORAGE,JSON.stringify(session));}catch{}return session.access_token;}).finally(()=>refreshing=null);
 return refreshing;
}
async function rpc(name,body={}){return call('/rest/v1/rpc/'+name,{body,token:await token()});}
function feedback(error){
 if(error.status===401||error.message.includes('LOGIN_REQUIRED')){deny('ログインの期限が切れました。AWAKENでログインし直してください。');return 'ログインし直してください。';}
 if(error.message.includes('ADMIN_REQUIRED')){deny('このアカウントには管理権限がありません。');return '管理権限がありません。';}
 if(error.message.includes('EMAIL_NOT_CONFIRMED'))return 'お客様のメール確認が完了していません。先にログインメールで確認してもらってください。';
 if(error.message.includes('NOT_ACTIVE_SUBSCRIBER'))return '現在は有効な会員ではありません。メールアドレスを検索し直してください。';
 return '処理結果を確認できませんでした。検索し直して現在の状態を確認してください。';
}
function permissions(record){
 if(record?.state==='preregistered')return {activate:false,end:false,label:'会員にする'};
 const active=record&&['subscriber_ready','subscriber_waiting'].includes(record.state);
 return {
  activate:Boolean(record?.email_confirmed&&(!active||record.membership_expires_at)),
  end:Boolean(record?.email_confirmed&&active&&(!record.membership_expires_at||record.membership_end_source==='customer')),
  label:active?(record.membership_expires_at?'終了予約を取り消す':'会員です'):'会員にする'
 };
}
function controls(){
 const allowed=permissions(target),locked=busy||listBusy;
 $('preregister-submit').disabled=locked;$('preregister-email').disabled=locked;
 $('cancel-preregistration').hidden=target?.state!=='preregistered';$('cancel-preregistration').disabled=locked||target?.state!=='preregistered'||!target?.preregistration_pending;
 $('activate').hidden=target?.state==='preregistered';$('end-month').hidden=target?.state==='preregistered';
 $('search').disabled=locked;$('customer-email').disabled=locked;
 $('activate').disabled=locked||!allowed.activate;$('end-month').disabled=locked||!allowed.end;
 $('activate').textContent=allowed.label;
 for(const id of ['apply-filter','refresh-list','page-size'])$(id).disabled=locked;
 $('previous-page').disabled=locked||listState.page<=1;
 $('next-page').disabled=locked||listState.page*listState.pageSize>=listState.total;
 for(const button of $('registrants').querySelectorAll('button'))button.disabled=locked||button.dataset.allowed!=='true';
}

function render(data){
 target=data.found?data:null;$('customer').hidden=!target;
 if(target){
  $('result-email').textContent=target.email;
  $('member-state').textContent=messages[target.state]||'状態を確認してください';
  $('email-confirmed').textContent=target.email_confirmed?'確認済み':'未確認（先にメール確認が必要です）';
  $('next-draw').textContent=target.can_draw?'今すぐ利用できます':date(target.next_available_at);
  $('last-draw').textContent=date(target.last_draw_at);
  $('end-source').textContent=target.membership_expires_at?(target.membership_end_source==='customer'?'お客様ご自身':'管理者'):'—';
  $('end-date').textContent=target.membership_expires_at?date(target.membership_expires_at)+' から利用不可':'終了予約なし';
 }
 controls();
}
$('customer-email').addEventListener('input',()=>{revision++;target=null;$('customer').hidden=true;controls();$('message').textContent='';});
$('lookup').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||listBusy)return;
 const current=++revision;busy=true;target=null;$('customer').hidden=true;controls();$('message').textContent='確認しています…';
 try{const data=await rpc('awaken_admin_lookup',{p_email:$('customer-email').value.trim()});if(current!==revision)return;render(data);$('message').textContent=data.found?'登録情報を確認してください。':'登録が見つかりません。お客様に先にAWAKENでメール登録してもらってください。';}
 catch(error){if(current===revision)$('message').textContent=feedback(error);}
 finally{busy=false;controls();}
});
async function change(action,selected=target){
 if(busy||listBusy||!selected)return;
 const current={...selected};const epoch=authEpoch;
 if(!(action==='activate'?permissions(current).activate:permissions(current).end))return;
 const continuing=['subscriber_ready','subscriber_waiting'].includes(current.state);
 const description=action==='end_month'?'日本時間の今月末まで利用でき、翌月1日0時に会員資格が終了します。7日間隔は変わりません。この管理者の終了予約は、お客様からは取り消せなくなります。':continuing?'月末終了の予約を取り消します。利用回数は増えません。':'入金を確認しましたか？ 会員にするとすぐ1回引け、その後は前回から7日ごとに利用できます。';
 if(!window.confirm(current.email+'\n\n'+description))return;
 busy=true;controls();$('message').textContent='変更しています…';
 try{
  const data=await rpc('awaken_admin_change',{p_user_id:current.user_id,p_action:action});if(epoch!==authEpoch)return;
  revision++;$('customer-email').value=data.email;render(data);
  const notice=action==='end_month'?'月末で終了する予約を保存しました。':'会員情報を保存しました。お客様はAWAKENを再読み込みすると確認できます。';
  const refreshed=await loadList();if(epoch!==authEpoch)return;
  $('message').textContent=notice;
  $('list-message').textContent=data.email+'：'+notice+(refreshed?'':' 一覧を再取得できなかったため、「最新に更新」で確認してください。');
 }
 catch(error){if(epoch!==authEpoch)return;target=null;$('customer').hidden=true;const message=feedback(error);$('message').textContent=message;$('list-message').textContent=message;}
 finally{busy=false;controls();}
}
$('activate').addEventListener('click',()=>change('activate'));
$('end-month').addEventListener('click',()=>change('end_month'));
function clearList(){
 listRows=[];listState.total=0;$('registrants').replaceChildren();$('list-count').textContent='';$('page-label').textContent='1 / 1';$('list-message').textContent='';
}
function compactDate(value){
 return value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
}
function selectRecord(record){
 if(busy||listBusy)return;
 revision++;$('customer-email').value=record.email;render(record);$('message').textContent='一覧で選んだ登録者の情報です。';
 $('result-email').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});$('result-email').focus({preventScroll:true});
}
function renderList(){
 const fragment=document.createDocumentFragment();
 const labels=['登録メールアドレス','現在の状態','無料体験','前回引いた日時','次に引ける日時','退会予約','退会予定日','操作'];
 for(const record of listRows){
  const row=document.createElement('tr');row.dataset.userId=record.user_id||'pending:'+record.email;
  const add=(text,index,className='')=>{const cell=document.createElement('td');cell.dataset.label=labels[index];cell.className=className;cell.textContent=text;row.append(cell);return cell;};
  const email=add(record.email,0,'email-cell');if(!record.email_confirmed){const note=document.createElement('small');note.textContent='メール未確認';email.append(note);}
  const stateLabel={preregistered:'事前登録',trial_ready:'無料体験',trial_used:'無料体験',subscriber_ready:'会員',subscriber_waiting:'会員',expired:'終了',disabled:'利用停止'}[record.state]||'確認が必要';
  const cell=add('',1),badge=document.createElement('span');badge.className='badge';badge.textContent=stateLabel;cell.append(badge);
  add(record.trial_used?'利用済み':'未使用',2);add(compactDate(record.last_draw_at),3);
  const next=record.state==='preregistered'?'初回認証後':!record.email_confirmed?'メール確認後':record.can_draw?'今すぐ':record.state==='subscriber_waiting'?compactDate(record.next_available_at):record.state==='trial_used'?'体験利用済み':'利用不可';add(next,4);
  const ending=['subscriber_ready','subscriber_waiting'].includes(record.state)&&Boolean(record.membership_expires_at);
  const source=record.membership_end_source==='customer'?'お客様':'管理者';
  add(record.membership_expires_at?(ending?'あり':'終了済み')+'（'+source+'）':'なし',5);
  const endCell=add('—',6);
  if(record.membership_expires_at){
   endCell.textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(new Date(record.membership_expires_at).getTime()-1))+'まで';
   const precise=document.createElement('small');precise.textContent=compactDate(record.membership_expires_at)+'から利用不可';endCell.append(precise);
  }
  const actionCell=add('',7,'row-actions'),buttons=document.createElement('div');buttons.className='row-buttons';const allowed=permissions(record);
  const actions=record.state==='preregistered'?[['details','詳細・操作',true],['cancel_prereg','事前登録を取り消す',Boolean(record.preregistration_pending)]]:[['details','詳細・操作',true],['activate',allowed.label,allowed.activate],['end_month','月末で終了',allowed.end]];
  for(const [action,label,permitted] of actions){
   const button=document.createElement('button');button.type='button';button.dataset.action=action;button.dataset.allowed=String(permitted);button.textContent=label;if(action!=='activate')button.className='secondary';
   button.addEventListener('click',()=>{if(action==='details')selectRecord(record);else if(action==='cancel_prereg')cancelPreregistration(record);else change(action,record);});buttons.append(button);
  }
  actionCell.append(buttons);fragment.append(row);
 }
 $('registrants').replaceChildren(fragment);
 const pages=Math.max(1,Math.ceil(listState.total/listState.pageSize));$('page-label').textContent=listState.page+' / '+pages;
 const first=listState.total?(listState.page-1)*listState.pageSize+1:0,last=Math.min(listState.page*listState.pageSize,listState.total);
 $('list-count').textContent='全'+listState.total+'件'+(listState.total?' ／ '+first+'〜'+last+'件を表示':'');controls();
}
async function loadList(){
 const epoch=authEpoch,current=++listRevision;listBusy=true;controls();$('list-message').textContent='登録者一覧を読み込んでいます…';
 try{
  const data=await rpc('awaken_admin_list',{p_filter:listState.filter,p_search:listState.search,p_page:listState.page,p_page_size:listState.pageSize});
  if(epoch!==authEpoch||current!==listRevision)return false;
  if(!Array.isArray(data?.rows)||!Number.isInteger(data.total)||data.total<0)throw new Error('INVALID_LIST');
  listState.total=data.total;
  const lastPage=Math.max(1,Math.ceil(data.total/listState.pageSize));
  if(listState.page>lastPage){listState.page=lastPage;return await loadList();}
  listRows=data.rows;renderList();$('list-message').textContent=data.total?'':'条件に一致する登録者はいません。';return true;
 }catch(error){
  if(epoch!==authEpoch||current!==listRevision)return false;
  clearList();$('list-message').textContent=error.code==='PGRST202'?'一覧表示の追加設定が完了していません。個別のメール検索は引き続き利用できます。':feedback(error);return false;
 }finally{if(current===listRevision){listBusy=false;controls();}}
}
$('list-filters').addEventListener('submit',event=>{event.preventDefault();if(busy||listBusy)return;listState.filter=$('status-filter').value;listState.search=$('list-email').value.trim();listState.page=1;loadList();});
$('refresh-list').addEventListener('click',()=>{if(!busy&&!listBusy)loadList();});
$('page-size').addEventListener('change',()=>{if(busy||listBusy)return;listState.pageSize=Number($('page-size').value);listState.page=1;loadList();});
$('previous-page').addEventListener('click',()=>{if(busy||listBusy||listState.page<=1)return;listState.page--;loadList();});
$('next-page').addEventListener('click',()=>{if(busy||listBusy||listState.page*listState.pageSize>=listState.total)return;listState.page++;loadList();});
$('preregister').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||listBusy)return;
 const email=$('preregister-email').value.trim(),epoch=authEpoch;
 if(!window.confirm(email+'\n\n入金を確認済みですか？\n未登録のお客様は初回のメール本人確認後に会員になります。この操作ではメールを送信しません。すでに有効な会員の回数・退会予約は変更しません。'))return;
 busy=true;controls();$('preregister-message').textContent='事前登録を保存しています…';
 try{
  const data=await rpc('awaken_admin_preregister',{p_email:email});if(epoch!==authEpoch)return;
  revision++;$('customer-email').value=data.email;render(data);await loadList();if(epoch!==authEpoch)return;
  $('preregister-message').textContent=data.registration_kind==='pending'?'事前登録しました。お客様は同じメールアドレスで初回認証をしてください。メール送信は行っていません。':'会員情報を確認・保存しました。すでに有効な会員の利用回数や退会予約は変更していません。';
 }catch(error){if(epoch!==authEpoch)return;$('preregister-message').textContent=error.message.includes('INVALID_EMAIL')?'メールアドレスを確認してください。':error.message.includes('REGISTRATION_ALREADY_LINKED')?'このアドレスには既存の登録記録があります。登録者情報を確認してください。':feedback(error);}
 finally{busy=false;controls();}
});
async function cancelPreregistration(record=target){
 if(busy||listBusy||record?.state!=='preregistered'||!record.preregistration_pending)return;
 const epoch=authEpoch,email=record.email;
 if(!window.confirm(email+'\n\n入金確認済みの事前登録を取り消しますか？ アカウントやカード記録は削除しません。本人確認が完了して会員になった後は、この操作では取り消せません。'))return;
 busy=true;controls();
 try{await rpc('awaken_admin_cancel_preregistration',{p_email:email});if(epoch!==authEpoch)return;render({found:false});await loadList();if(epoch===authEpoch)$('preregister-message').textContent='事前登録を取り消しました。';}
 catch(error){if(epoch===authEpoch)$('preregister-message').textContent=feedback(error);}
 finally{busy=false;controls();}
}
$('cancel-preregistration').addEventListener('click',()=>cancelPreregistration());
async function initialize(){
 deny('管理権限を確認しています…');const epoch=authEpoch;
 try{
  try{session=JSON.parse(localStorage.getItem(STORAGE));}catch{}
  if(!session?.access_token||!session?.refresh_token){deny('先にAWAKENの画面で、管理者のメールアドレスでログインしてください。');return;}
  const access=await token();await call('/auth/v1/user',{method:'GET',token:access});
  const admin=await rpc('awaken_is_admin');if(epoch!==authEpoch)return;
  if(admin!==true){deny('このアカウントには管理権限がありません。');return;}
  $('gate').hidden=true;$('manager').hidden=false;controls();await loadList();
 }catch(error){deny(error.status===401?'AWAKENでログインし直してください。':'管理機能の設定または通信状況を確認してください。管理者の設定が必要な場合があります。');}
}
window.addEventListener('storage',event=>{if(event.key===STORAGE){deny('ログイン状態が変更されました。管理画面を開き直してください。');session=null;}});
window.addEventListener('pageshow',event=>{if(event.persisted)initialize();});
initialize();
