import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../number-draw/',import.meta.url);
export function validateRegistry(cards){
 if(!Array.isArray(cards)||cards.length!==44)throw new Error('カードは44枚必要です');
 cards.forEach((card,i)=>{
  if(card.number!==i+1)throw new Error('番号は1〜44の順で重複なく登録してください');
  if(!['name','message'].every(k=>typeof card[k]==='string'&&card[k].trim()))throw new Error(`${i+1}番の名前とメッセージが必要です`);
  if(!Array.isArray(card.keywords)||card.keywords.length!==3||!card.keywords.every(k=>typeof k==='string'&&k.trim()))throw new Error(`${i+1}番のキーワードは3つ必要です`);
  if(card.image!==String(card.number).padStart(2,'0')+'.webp')throw new Error(`${i+1}番の画像番号を確認してください`);
 });return cards;
}
export async function build(){
 const cards=validateRegistry(JSON.parse(await readFile(new URL('cards.json',root),'utf8')));
 const file=new URL('index.html',root);const html=await readFile(file,'utf8');
 const data=JSON.stringify(cards).replace(/</g,'\\u003c');
 let output=html.replace(/\/\* CARD_REGISTRY_START \*\/[\s\S]*?\/\* CARD_REGISTRY_END \*\//,()=>`/* CARD_REGISTRY_START */\nconst cardRegistry=${data};\n/* CARD_REGISTRY_END */`);
 if(output.includes('/* AUTH_RUNTIME_START */')){
  const auth=await readFile(new URL('auth.js',root),'utf8');
  output=output.replace(/\/\* AUTH_RUNTIME_START \*\/[\s\S]*?\/\* AUTH_RUNTIME_END \*\//,()=>`/* AUTH_RUNTIME_START */\n${auth}\n/* AUTH_RUNTIME_END */`);
 }
 if(output===html&&!html.includes('const cardRegistry='+data))throw new Error('登録領域がありません');
 if(Buffer.byteLength(output)>1024*1024)throw new Error('プレビュー容量の上限を超えています');
 await writeFile(file,output);console.log('Registered five fields for all 44 cards');
}
if(process.argv[1]===new URL(import.meta.url).pathname)await build();
