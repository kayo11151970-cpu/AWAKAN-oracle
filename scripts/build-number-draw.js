import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../number-draw/',import.meta.url);
export function validateRegistry(cards){
 if(!Array.isArray(cards)||cards.length!==44)throw new Error('カードは44枚必要です');
 cards.forEach((card,i)=>{
  if(card.number!==i+1)throw new Error('番号は1〜44の順で重複なく登録してください');
  if(!['name','message'].every(k=>typeof card[k]==='string'&&card[k].trim()))throw new Error(`${i+1}番の名前とメッセージが必要です`);
  if(!Array.isArray(card.keywords)||card.keywords.length!==3||!card.keywords.every(k=>typeof k==='string'&&k.trim()))throw new Error(`${i+1}番のキーワードは3つ必要です`);
  if(typeof card.youtubeUrl!=='string')throw new Error('動画URLは文字列で入力してください');
  if(card.youtubeUrl){
   const url=new URL(card.youtubeUrl);
   if(url.protocol!=='https:'||url.username||url.password||url.port||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname))throw new Error(`${i+1}番はHTTPSのYouTube URLを指定してください`);
   const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1];
   if(!/^[\w-]{11}$/.test(id||''))throw new Error(`${i+1}番は個別の動画URLを指定してください`);
  }
 });return cards;
}
export async function build(){
 const cards=validateRegistry(JSON.parse(await readFile(new URL('cards.json',root),'utf8')));
 const file=new URL('index.html',root);const html=await readFile(file,'utf8');
 const data=JSON.stringify(cards).replace(/</g,'\\u003c');
 const output=html.replace(/\/\* CARD_REGISTRY_START \*\/[\s\S]*?\/\* CARD_REGISTRY_END \*\//,()=>`/* CARD_REGISTRY_START */\nconst cardRegistry=${data};\n/* CARD_REGISTRY_END */`);
 if(output===html&&!html.includes('const cardRegistry='+data))throw new Error('登録領域がありません');
 if(Buffer.byteLength(output)>1024*1024)throw new Error('プレビュー容量の上限を超えています');
 await writeFile(file,output);console.log('Registered 44 cards; YouTube configured: '+cards.filter(c=>c.youtubeUrl).length);
}
if(process.argv[1]===new URL(import.meta.url).pathname)await build();
