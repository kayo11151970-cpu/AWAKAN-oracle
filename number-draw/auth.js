// Authentication and eligibility are checked by Supabase, not browser storage.
const apiUrl='https://mmfsavdfiskhvypkrjnb.supabase.co';
const publishableKey='sb_publishable_L29n6t4Rw-_THcwQQRBNaw_5D78IwDK';
const redirectUrl='https://kayo11151970-cpu.github.io/AWAKAN-oracle/';
const sessionKey='awaken-auth-v1';
const el=id=>document.getElementById(id);
let session=null,user=null,busy=false,refreshing=null;
function saveSession(value){session=value;try{if(value)localStorage.setItem(sessionKey,JSON.stringify(value));else localStorage.removeItem(sessionKey);}catch{}}
function normalizedSession(data){return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+Number(data.expires_in||3600)};}
async function request(path,{method='GET',body,token}={}){
 const response=await fetch(apiUrl+path,{method,headers:{apikey:publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const error=new Error(data?.message||data?.msg||data?.error_description||'REQUEST_FAILED');error.status=response.status;throw error;}
 return data;
}
async function accessToken(){
 if(!session)throw new Error('LOGIN_REQUIRED');
 if(session.expires_at*1000>Date.now()+60000)return session.access_token;
 if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(data=>{saveSession(normalizedSession(data));return session.access_token;}).finally(()=>{refreshing=null;});
 return refreshing;
}
function hideResult(){el('card-image').hidden=true;el('details').hidden=true;el('number').textContent='—';}
function loggedOut(){user=null;saveSession(null);hideResult();el('login-form').hidden=false;el('account').hidden=true;el('draw').disabled=true;el('status').textContent='メールでログインしてからカードを引いてください。';}
function dateLabel(value){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+'（日本時間）';}
async function showCard(number){
 if(!Number.isInteger(number)||number<1||number>44)throw new Error('INVALID_CARD');
 const image=new Image();image.src=cardImages[number-1];await image.decode();
 el('card-image').src=image.src;el('card-image').alt=`${number}番のオラクルカード`;el('card-image').hidden=false;
 const card=cardRegistry[number-1];el('card-name').textContent=card.name;el('card-message').textContent=card.message;el('keywords').textContent=card.keywords.join(' ／ ');el('details').hidden=false;el('number').textContent=String(number);
}
async function loadMembership(){
 const token=await accessToken();
 const rows=await request('/rest/v1/awaken_members?select=membership,trial_used,last_draw_at,last_card_number&user_id=eq.'+encodeURIComponent(user.id),{token});
 const member=rows?.[0];
 if(member?.membership==='disabled'){hideResult();el('draw').disabled=true;el('status').textContent='現在、このアカウントでは利用できません。管理者にお問い合わせください。';return;}
 if(member?.last_card_number)await showCard(member.last_card_number);
 const next=member?.last_draw_at?new Date(new Date(member.last_draw_at).getTime()+168*60*60*1000):null;
 if(member?.membership==='subscriber'){
  el('draw').disabled=Boolean(next&&Date.now()<next.getTime());
  el('status').textContent=el('draw').disabled?'次に引ける日時：'+dateLabel(next):'会員としてカードを引けます。次回は今回の抽選から7日後です。';
 }else{
  el('draw').disabled=Boolean(member?.trial_used);
  el('status').textContent=member?.trial_used?'無料体験は利用済みです。前回のカードを表示しています。':'無料体験は、このアカウントで1回だけご利用いただけます。';
 }
}
function explain(error){
 const text=error.message||'';
 if(text.includes('ACCOUNT_DISABLED'))return '現在、このアカウントでは利用できません。';
 if(text.includes('TRIAL_ALREADY_USED'))return '無料体験は利用済みです。';
 if(text.includes('WAIT_SEVEN_DAYS'))return '前回から7日後に、もう一度引けます。';
 if(text.includes('LOGIN_REQUIRED')||error.status===401)return 'ログインの有効期限が切れました。ログインし直してください。';
 return '通信または設定の確認が必要です。画面を再読み込みして利用状況を確認してください。';
}
el('login-form').addEventListener('submit',async event=>{
 event.preventDefault();el('send-link').disabled=true;el('login-status').textContent='ログインメールを送信しています…';
 try{
  await request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirectUrl),{method:'POST',body:{email:el('email').value.trim(),create_user:false}});
  el('login-status').textContent='登録済みのメールアドレスの場合、ログイン用リンクが届きます。メールを確認してください。';
 }catch{el('login-status').textContent='メールを送信できませんでした。登録アドレス・送信設定をご確認のうえ、少し待ってからお試しください。';}
 finally{el('send-link').disabled=false;}
});
el('logout').addEventListener('click',async()=>{
 const token=session?.access_token;loggedOut();if(token)try{await request('/auth/v1/logout',{method:'POST',token});}catch{}
});
el('draw').addEventListener('click',async()=>{
 if(busy||!user)return;busy=true;el('draw').disabled=true;el('status').textContent='カードを選んでいます…';
 try{
  const token=await accessToken();
  const result=await request('/rest/v1/rpc/awaken_draw',{method:'POST',body:{},token});
  const reading=result?.[0];if(!reading)throw new Error('INVALID_RESULT');
  await showCard(reading.card_number);
  el('status').textContent=reading.next_available_at?'次に引ける日時：'+dateLabel(reading.next_available_at):'無料体験をご利用いただきました。今回のカードはログイン後も確認できます。';
 }catch(error){
  el('status').textContent=explain(error);
  if(error.status===401){loggedOut();el('login-status').textContent=explain(error);}
 }finally{busy=false;}
});
async function initialize(){
 el('draw').disabled=true;
 try{
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('error')){history.replaceState(null,'',location.pathname+location.search);throw new Error('LINK_EXPIRED');}
  if(fragment.has('access_token')){
   if(!fragment.get('refresh_token'))throw new Error('INVALID_SESSION');
   saveSession(normalizedSession(Object.fromEntries(fragment)));history.replaceState(null,'',location.pathname+location.search);
  }else{try{const saved=JSON.parse(localStorage.getItem(sessionKey));if(saved?.access_token&&saved?.refresh_token)session=saved;}catch{}}
  if(!session){loggedOut();return;}
  const token=await accessToken();user=await request('/auth/v1/user',{token});
  el('login-form').hidden=true;el('account').hidden=false;el('account-email').textContent=user.email;
  await loadMembership();
 }catch(error){
  if(error.status===401||error.status===400||error.message==='LINK_EXPIRED'||error.message==='INVALID_SESSION'){
   loggedOut();el('login-status').textContent='ログインリンクの期限切れ、または認証情報が無効です。メールを送り直してください。';
  }else if(!session){loggedOut();}else{el('status').textContent=explain(error);}
 }
}
window.addEventListener('hashchange',()=>{if(location.hash)initialize();});
initialize();
