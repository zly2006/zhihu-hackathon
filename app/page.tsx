'use client';
import {useEffect,useRef,useState} from 'react';
import type {GameEvent,Gender,PublicState,StoryBackground} from '../lib/story';

type PoolMember={id:string;name:string;gender:Gender;age:number;identity:string;background?:string;zhihuHandle?:string};
type ViewNode={title?:string;lines:{speaker:string;text:string}[];choices:{text:string}[];readingSeconds?:number};
type StoryTemplate={state:PublicState|null;pool:PoolMember[];backgrounds:StoryBackground[];requiredCastCount:number;maxStages:number;defaultBackgroundId:string};
type ProfileEdit={background:string;zhihuHandle:string};

const symbols=Array.from('一二三四五六七八');
const colors=['#476a68','#ad6847','#65789a','#8a6b4d','#b4534b','#6f7b4b','#4d718e','#a45d73'];

function adapted(member:PoolMember,background?:StoryBackground):PoolMember{
 const role=background?.cast[member.id];
 return role?{...member,age:role.age,identity:role.identity}:member;
}

export default function Home(){
 const [state,setState]=useState<PublicState|null>(null);
 const [partial,setPartial]=useState<ViewNode|null>(null);
 const [pool,setPool]=useState<PoolMember[]>([]);
 const [backgrounds,setBackgrounds]=useState<StoryBackground[]>([]);
 const [requiredCastCount,setRequiredCastCount]=useState(4);
 const [maxStages,setMaxStages]=useState(7);
 const [busy,setBusy]=useState(false);
 const [ready,setReady]=useState(false);
 const [line,setLine]=useState(0);
 const [status,setStatus]=useState('');
 const [error,setError]=useState('');
 const [history,setHistory]=useState(false);
 const [confirm,setConfirm]=useState(false);
 const [panelOpen,setPanelOpen]=useState(false);
 const [setupOpen,setSetupOpen]=useState(true);
 const [setupStep,setSetupStep]=useState(0);
 const [selected,setSelected]=useState<string[]>([]);
 const [profiles,setProfiles]=useState<Record<string,ProfileEdit>>({});
 const [selectedBackgroundId,setSelectedBackgroundId]=useState('university');
 const [playerName,setPlayerName]=useState('许澄');
 const [playerGender,setPlayerGender]=useState<Gender>('女');
 const busyRef=useRef(false);

 const totalStages=state?.total||6;
 const node=partial||state?.nodes.at(-1)||null;
 const currentLine=node?.lines[line];
 const atEnd=!!node&&line>=node.lines.length-1;
 const waiting=!!partial||!!state?.pending;
 const selectedBackground=backgrounds.find((item)=>item.id===selectedBackgroundId);
 const activeBackground=state?.world.background||selectedBackground;
 const sceneAsset=state?.world.background.sceneAsset||activeBackground?.sceneAsset||'/assets/courtyard-sunset.webp';
 const displayedPool=pool.map((member)=>adapted(member,selectedBackground));
 const stateCast:PoolMember[]=state?.world.cast?.length?state.world.cast:[];
 const displayedCast=stateCast.length?stateCast:selected.map((id)=>pool.find((member)=>member.id===id)).filter((member):member is PoolMember=>!!member).map((member)=>adapted(member,selectedBackground));
 const cast=displayedCast.map((member,index)=>({
  ...member,
  symbol:symbols[pool.findIndex((candidate)=>candidate.id===member.id)%symbols.length]||symbols[index%symbols.length],
  color:colors[pool.findIndex((candidate)=>candidate.id===member.id)%colors.length]||colors[index%colors.length],
  detail:member.background?.trim()||'在这段人生里，这一点选择会改变彼此的距离。',
 }));
 const locations=state?.world.locations?.length?state.world.locations:selectedBackground?.locations||[];

 async function restore(){
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),8000);
  let response:Response;
  try{
   const storyId=localStorage.getItem('story_pathway_id');
   response=await fetch(`/api/story${storyId?`?storyId=${encodeURIComponent(storyId)}`:''}`,{signal:controller.signal});
  }finally{window.clearTimeout(timeout);}
  if(!response.ok)throw new Error('暂时无法读取存档。');
  const data=await response.json() as StoryTemplate;
  if(Array.isArray(data.pool)&&data.pool.length)setPool(data.pool);
  if(Array.isArray(data.backgrounds)&&data.backgrounds.length)setBackgrounds(data.backgrounds);
  if(Number.isInteger(data.requiredCastCount))setRequiredCastCount(data.requiredCastCount);
  if(Number.isInteger(data.maxStages))setMaxStages(data.maxStages);
  setState(data.state);
  setPartial(data.state?.partial||null);
  if(data.state){
   setSetupOpen(false);
   setSelected(data.state.world.cast.map((member)=>member.id));
   setProfiles(Object.fromEntries(data.state.world.cast.map((member)=>[member.id,{background:member.background||'',zhihuHandle:member.zhihuHandle||''}])));
   setSelectedBackgroundId(data.state.world.background.id);
   setPlayerName(data.state.world.player.name);
   setPlayerGender(data.state.world.player.gender);
  }else{
   setSelectedBackgroundId(data.defaultBackgroundId||'university');
   localStorage.removeItem('story_pathway_id');
  }
  setReady(true);
  return data.state;
 }

 useEffect(()=>{restore().catch((cause)=>{setError(cause instanceof Error?cause.message:'暂时无法读取存档。');setReady(true);});},[]);

 async function act(action:string,choice?:number){
  if(busyRef.current)return;
  busyRef.current=true;
  setBusy(true);
  setError('');
  setStatus('正在打开这一页…');
  if(action==='start'||action==='restart'){setPartial(null);setLine(0);}
  try{
   const selectedProfiles=selected.map((id)=>{
    const member=pool.find((candidate)=>candidate.id===id);
    if(!member)throw new Error('角色池已变化，请刷新页面后重试。');
    return {id:member.id,name:member.name,gender:member.gender,...(profiles[id]||{})};
   });
   const response=await fetch('/api/story',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     storyId:localStorage.getItem('story_pathway_id')||undefined,
     action,
     ...(choice!==undefined?{choice,expected:state?.nodes.length}:{}),
     ...((action==='start'||action==='restart')?{profiles:selectedProfiles,backgroundId:selectedBackgroundId,player:{name:playerName.trim(),gender:playerGender}}:{}),
    }),
   });
   const responseStoryId=response.headers.get('X-Story-Id');
   if(responseStoryId)localStorage.setItem('story_pathway_id',responseStoryId);
   if(!response.ok){const data=await response.json();throw new Error(data.error||'暂时无法继续。');}
   if(!response.headers.get('content-type')?.includes('text/event-stream')){
    const data=await response.json();
    setState(data.state);
    setPartial(data.state?.partial||null);
    return;
   }
   const reader=response.body!.getReader();
   const decoder=new TextDecoder();
   let buffer='';
   let finished=false;
   const receive=(event:GameEvent)=>{
    if(event.type==='status')setStatus(event.message);
    if(event.type==='scene'){setPartial({title:event.title,lines:[],choices:[]});setLine(0);}
    if(event.type==='line')setPartial((old)=>{
     const next={...(old||{lines:[],choices:[]})};
     next.lines=[...next.lines];
     next.lines[event.index]={speaker:event.speaker,text:event.text};
     return next;
    });
    if(event.type==='choices')setPartial((old)=>old?{...old,choices:event.items}:old);
    if(event.type==='done'){setState(event.state);setPartial(null);finished=true;setStatus('');}
    if(event.type==='error')throw new Error(event.message);
   };
   try{
    while(true){
     const part=await reader.read();
     buffer+=decoder.decode(part.value,{stream:!part.done});
     const rows=buffer.split('\n');
     buffer=rows.pop()||'';
     for(const row of rows)if(row.startsWith('data:'))receive(JSON.parse(row.slice(5)));
     if(part.done)break;
    }
   }finally{await reader.cancel().catch(()=>{});}
   if(!finished)throw new Error('连接中断，已收到的对白会保留。');
  }catch(cause){
   setError(cause instanceof Error?cause.message:'暂时无法继续。');
   await restore().catch(()=>{});
   if(action==='start'||action==='restart')setSetupOpen(true);
  }finally{
   busyRef.current=false;
   setBusy(false);
   setStatus('');
  }
 }

 function advance(){if(node&&line<node.lines.length-1)setLine(line+1);}
 function toggleMember(id:string){setSelected((current)=>current.includes(id)?current.filter((item)=>item!==id):current.length<requiredCastCount?[...current,id]:current);}
 function restartSelection(){
  setConfirm(false);setPanelOpen(false);
  if(state){
   setSelected(state.world.cast.map((member)=>member.id));
   setProfiles(Object.fromEntries(state.world.cast.map((member)=>[member.id,{background:member.background||'',zhihuHandle:member.zhihuHandle||''}])));
   setSelectedBackgroundId(state.world.background.id);
   setPlayerName(state.world.player.name);setPlayerGender(state.world.player.gender);
  }else{setSelected([]);setProfiles({});}
  setState(null);setPartial(null);setLine(0);setError('');setSetupStep(0);setSetupOpen(true);localStorage.removeItem('story_pathway_id');
 }
 function stepTo(next:number){if(next>setupStep)return;setSetupStep(next);}
 function canAdvance(){if(setupStep===0)return !!selectedBackgroundId;if(setupStep===1)return selected.length===requiredCastCount;return selected.length===requiredCastCount&&!!selectedBackgroundId&&!!playerName.trim();}
 function nextSetup(){if(!canAdvance())return;if(setupStep<2){setSetupStep(setupStep+1);return;}setSetupOpen(false);void act('start');}
 function profileValue(id:string,key:keyof ProfileEdit){return profiles[id]?.[key]||'';}
 function updateProfile(id:string,key:keyof ProfileEdit,value:string){setProfiles((current)=>({...current,[id]:{background:current[id]?.background||'',zhihuHandle:current[id]?.zhihuHandle||'',[key]:value}}));}

 useEffect(()=>{
  const listener=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){setHistory(false);setConfirm(false);setPanelOpen(false);return;}
   const target=event.target;
   if(target instanceof HTMLElement&&(target.closest('input,textarea,select,button,summary')||target.isContentEditable))return;
   if(history||confirm||panelOpen||setupOpen)return;
   if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();advance();}
   if(event.key==='f'){if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen();}
  };
  window.addEventListener('keydown',listener);
  return()=>window.removeEventListener('keydown',listener);
 });

 useEffect(()=>{
  const target=window as unknown as {render_game_to_text:()=>string;advanceTime:(ms:number)=>void};
  target.render_game_to_text=()=>JSON.stringify({mode:history?'history':setupOpen?'setup':!node?'start':state?.complete?'ending':'reading',setupOpen,setupStep,busy,pending:waiting,poolCount:pool.length,background:selectedBackgroundId,playerGender,playerName,requiredCastCount,selectedCount:selected.length,segment:state?.nodes.length||0,total:totalStages,receivedLines:node?.lines.length||0,line:line+1,speaker:currentLine?.speaker,text:currentLine?.text,choices:atEnd&&!waiting?node?.choices:[],route:state?.route,relationshipType:state?.relationshipType,error});
  target.advanceTime=()=>{};
 },[node,state,line,busy,history,waiting,error,atEnd,currentLine,pool.length,requiredCastCount,selected.length,totalStages,setupOpen,setupStep,selectedBackgroundId,playerGender,playerName]);

 const selectedMembers=selected.map((id)=>displayedPool.find((member)=>member.id===id)).filter((member):member is PoolMember=>!!member);

 return <main onContextMenu={(event)=>{event.preventDefault();if(!setupOpen)setPanelOpen((open)=>!open);}}>
  {setupOpen&&<div className="setup-shell" role="dialog" aria-modal="true" aria-label="故事开局设定">
   <div className="setup-panel">
    <header className="setup-header"><div><p className="brand-mark">此间 <span>/</span> STORY</p><small>把一段人生，交给几个人的相互作用</small></div><div className="setup-progress">{[0,1,2].map((step)=><button key={step} className={setupStep===step?'active':step<setupStep?'done':''} disabled={step>setupStep} onClick={()=>stepTo(step)}><b>{String(step+1).padStart(2,'0')}</b><span>{step===0?'人生阶段':step===1?'同行者':'你的资料'}</span></button>)}</div></header>
    <div className="setup-content">
     {setupStep===0&&<section className="setup-stage"><div className="setup-title"><p>先决定故事发生的时刻</p><h2>人生阶段，不是结局</h2><span>阶段决定身份、地点、时间压力和可用的人生方向；真正的答案必须由后面的剧情逼出来。</span></div><div className="background-grid">{backgrounds.map((background)=><button key={background.id} data-background-id={background.id} className={`background-card ${selectedBackgroundId===background.id?'selected':''}`} onClick={()=>setSelectedBackgroundId(background.id)}><span className="background-ordinal">{background.ordinal}</span><strong>{background.label}</strong><small>{background.kicker}</small><p>{background.summary}</p><div className="background-facts"><span>{background.player.age} 岁</span><span>{background.locations[0]}</span><span>{background.lifeChoice.title}</span></div></button>)}</div>{selectedBackground&&<aside className="choice-brief"><p>贯穿本故事的选择</p><h3>{selectedBackground.lifeChoice.title}</h3><strong>{selectedBackground.lifeChoice.question}</strong><span>{selectedBackground.lifeChoice.pressure}</span></aside>}</section>}
     {setupStep===1&&<section className="setup-cast"><div className="setup-title"><p>{selectedBackground?.label||'当前阶段'} · 8 选 {requiredCastCount}</p><h2>选择将和玩家产生关系的人</h2><span>可以先任意组合。锁线后，若性别相同进入友情线，性别不同进入恋爱线。</span></div>{!pool.length?<div className="setup-loading">角色模板正在读取…</div>:<div className="cast-pool">{displayedPool.map((member)=><button key={member.id} data-character-id={member.id} className={selected.includes(member.id)?'selected':''} onClick={()=>toggleMember(member.id)}><span className="cast-index">{member.gender} · {member.age} 岁</span><strong>{member.name}</strong><p>{member.identity}</p><b>{selected.includes(member.id)?'已加入':'选择'}</b></button>)}</div>}<div className="selected-strip">{selectedMembers.map((member)=><span key={member.id}><b>{member.name}</b><small>{member.identity}</small></span>)}{Array.from({length:Math.max(0,requiredCastCount-selected.length)},(_,index)=><i key={index}>空缺 {selected.length+index+1}</i>)}</div>{!!selected.length&&<details className="profile-details"><summary>补充人物背景或知乎答主替身</summary>{selectedMembers.map((member)=><div className="profile-row" key={member.id}><b>{member.name}</b><input value={profileValue(member.id,'background')} placeholder="人物背景（可选）" onChange={(event)=>updateProfile(member.id,'background',event.target.value)}/><input value={profileValue(member.id,'zhihuHandle')} placeholder="知乎答主链接或用户名（可选）" onChange={(event)=>updateProfile(member.id,'zhihuHandle',event.target.value)}/></div>)}</details>}</section>}
     {setupStep===2&&<section className="setup-player"><div className="setup-title"><p>最后一步</p><h2>你是谁，也将影响关系怎么发生</h2><span>这个名字会出现在对白里。性别只用于决定锁定后的关系类型，不决定剧情质量或角色态度。</span></div><div className="player-form"><label><span>玩家姓名</span><input id="player-name" value={playerName} maxLength={16} onChange={(event)=>setPlayerName(event.target.value)}/></label><fieldset><legend>玩家性别</legend>{(['女','男'] as Gender[]).map((gender)=><button key={gender} data-player-gender={gender} className={playerGender===gender?'selected':''} onClick={()=>setPlayerGender(gender)}>{gender}</button>)}</fieldset></div><div className="setup-summary"><article><span>人生阶段</span><strong>{selectedBackground?.label||'未选择'}</strong><p>{selectedBackground?.lifeChoice.question}</p></article><article><span>同行者</span><strong>{selectedMembers.map((member)=>member.name).join(' / ')||'未选择'}</strong><p>{selectedMembers.map((member)=>member.identity).join('；')}</p></article><article><span>关系判定</span><strong>锁定后自动判定</strong><p>同性角色进入友情线，异性角色进入恋爱线；共同篇不会提前宣告结果。</p></article></div></section>}
    </div>
    <footer className="setup-footer"><button onClick={()=>setSetupStep(Math.max(0,setupStep-1))} disabled={setupStep===0}>上一步</button><div><span>{setupStep===0?(selectedBackground?.label||'请选择阶段'):setupStep===1?`${selected.length} / ${requiredCastCount} 位同行者`:`${playerName||'未命名'} · ${playerGender}`}</span><button id="start-story" className="primary" onClick={nextSetup} disabled={!canAdvance()||busy||!ready||!pool.length}>{setupStep<2?'继续设定':'开始故事'} <b>→</b></button></div></footer>
   </div>
  </div>}
  <header className="app-header"><a className="brand" href="/">此间<span> / </span>STORY</a><nav><span className="saved">● {busy?'正在续写':'进度自动保存'}</span><button onClick={()=>setPanelOpen((open)=>!open)} aria-expanded={panelOpen}>设定</button><button onClick={()=>setHistory(true)} disabled={!node}>回看</button><button onClick={()=>setConfirm(true)} disabled={busy||!node}>重新开始</button></nav></header>
  <div className={`story-shell ${panelOpen?'panel-open':''}`}>
   {panelOpen&&<button className="menu-backdrop" aria-label="关闭设定面板" onClick={()=>setPanelOpen(false)}/>}
   <aside className="drawer" inert={!panelOpen}><button className="drawer-close" onClick={()=>setPanelOpen(false)} aria-label="关闭">×</button><p className="eyebrow">{activeBackground?.label||'人生阶段'} · 互动故事</p><h1>{state?.storyTitle||'正在生成故事'}<span>。</span></h1><p className="intro">{state?.world?.premise||selectedBackground?.premise||'选择人生阶段与同行者后，故事会根据模板生成。'}</p><div className="life-choice"><small>贯穿全文的选择</small><strong>{activeBackground?.lifeChoice.title||'尚未确定'}</strong><p>{activeBackground?.lifeChoice.question||''}</p></div><div className="separator"/><div className="cast-heading">同行者 <span>{String(cast.length).padStart(2,'0')}</span></div><div className="people">{cast.map((member)=>{const progress=state?.relationshipProgress?.find((item)=>item.id===member.id);return <div className={`person ${state?.route===member.id?'chosen':''}`} key={member.id}><div className="portrait" style={{background:member.color}}>{member.symbol}</div><div><strong>{member.name}</strong><span>{member.identity}{state?.route===member.id?` · ${state.routeLabel||'已锁定'}`:''}</span><p>{member.detail}</p>{progress&&<small className="affinity">好感 {progress.affinity} · {progress.disclosure}</small>}</div></div>})}</div>{!!state?.selectedEvidence?.length&&<details className="evidence-box"><summary>上一选择的 3 条知乎依据</summary>{state.selectedEvidence.map((item)=><a key={item.contentId} href={item.url} target="_blank" rel="noreferrer">{item.title} · {item.author}</a>)}</details>}<footer><span>{state?.relationshipType?state.routeLabel:'共同篇 · 正在形成倾向'}</span><span>{state?.selections.length||0} 次选择已记录</span></footer></aside>
   <section className="story">
    <div className="scene"><img className="scene-art" src={sceneAsset} alt={`${activeBackground?.label||'故事'}场景`}/><div className="scene-wash"/><div className="scene-characters" aria-hidden="true"><img src="/assets/chibi-cast.webp" alt=""/></div><div className="scene-tag">{activeBackground?.ordinal||'00'} / {activeBackground?.label||'人生阶段'}</div><div className="hero-title"><small>{state?.routeLabel||activeBackground?.kicker||'从一件小事开始'}</small><h1>{state?.storyTitle||'选择一段人生'}<span>。</span></h1><p>{activeBackground?.lifeChoice.question||'阶段决定处境，剧情决定答案。'}</p></div><div className="scene-top"><span>{locations[0]||'故事现场'}</span><span>{locations[1]||'共同事务'}</span></div><div className="scene-bottom"><span>{locations.join(' · ')}</span><span>{state?.pending?`第 ${state.nodes.length+1} / ${totalStages} 段`:`最多 ${maxStages} 段`}</span></div></div>
    <div className="reader" aria-busy={busy}><div className="reader-head"><span>{state?`${String(Math.min(state.nodes.length+(partial?1:0),totalStages)).padStart(2,'0')} / ${String(totalStages).padStart(2,'0')}`:'PROLOGUE'}</span><span>{node?.title||'等待第一段故事'}</span><div className="dots">{Array.from({length:totalStages},(_,index)=><i key={index} className={index<(state?.nodes.length||0)?'active':''}/>)}</div></div>{!node?<div className="welcome"><h2>故事即将开始。</h2><p>{state?.world?.premise||selectedBackground?.premise||'选择人生阶段与同行者后，模型会按照模板生成第一段故事。'}</p><button id="start-btn" className="primary" disabled={busy||!ready||!selected.length} onClick={()=>act('start')}>{busy?'正在翻开故事…':'进入这一段人生'} <span>→</span></button></div>:<><div className="dialogue" aria-live="polite" onClick={advance} role="button" tabIndex={0} onKeyDown={(event)=>{if(event.key==='Enter'){event.preventDefault();advance();}}}><div className="speaker">{currentLine?.speaker||'旁白'}<span>—</span></div><p key={`${node.title}-${line}`}>{currentLine?.text||(busy?'第一段故事正在生成…':'这一页暂时没有对白。')}</p></div><div className="read-controls"><span>{node.lines.length?`${line+1} / ${node.lines.length} 句`:''}{partial?' · 继续传来中':''}</span>{!atEnd?<span className="click-hint">点击对话继续</span>:busy?<span className="loading">{status||'下一句话正在到来…'}</span>:null}</div>{atEnd&&!waiting&&!!node.choices.length&&<div className="choices"><small>这一次，我想……</small>{node.choices.map((choice,index)=>{const option=state?.lifeEvent?.options[Math.min(index,2)];return <div className="choice-card" key={`${choice.text}-${index}`}><button data-choice={index} disabled={busy} onClick={()=>act('choose',index)}><span>{String(index+1).padStart(2,'0')}</span>{choice.text}<b>→</b></button>{option&&<details className="choice-evidence"><summary>查看 3 条知乎回答依据</summary><p>{option.action}</p>{option.evidence.map((item)=><a key={item.contentId} href={item.url} target="_blank" rel="noreferrer">{item.title} · {item.author}</a>)}</details>}</div>})}</div>}{atEnd&&state?.complete&&<div className="ending"><span>FIN · 这段人生的这一步，到这里。</span><button onClick={restartSelection}>重新设定一段人生 →</button></div>}</>}{error&&<div className="error" role="alert">{error}<button disabled={busy} onClick={()=>act('retry')}>重试当前片段 →</button></div>}{waiting&&!busy&&!error&&<button className="resume" onClick={()=>act('retry')}>继续未完成的生成 →</button>}</div>
    <div className="bottom-note"><span>{state?.world?.background?.lifeChoice?.title||'人生阶段决定冲突来源'}</span><div className="bottom-toolbar"><button onClick={()=>setPanelOpen((open)=>!open)} aria-label="打开设定面板">设定</button><button onClick={()=>setHistory(true)} disabled={!node} aria-label="回看故事">回看</button><button onClick={()=>setConfirm(true)} disabled={!node||busy} aria-label="重新开始">重置</button></div><span>点击对白 / 空格 / → 推进</span></div>
   </section>
  </div>
  {history&&<div className="modal" role="dialog" aria-modal="true" aria-label="回看故事"><div className="history"><button className="close" onClick={()=>setHistory(false)}>关闭 ×</button><h2>已经发生的事</h2>{state?.nodes.map((entry,index)=><article key={index}><h3>{index+1}. {entry.title}</h3>{entry.lines.map((textEntry,lineIndex)=><p key={lineIndex}><b>{textEntry.speaker}</b>{textEntry.text}</p>)}</article>)}{partial&&<article><h3>{partial.title} · 正在继续</h3>{partial.lines.map((textEntry,lineIndex)=><p key={lineIndex}><b>{textEntry.speaker}</b>{textEntry.text}</p>)}</article>}</div></div>}
  {confirm&&<div className="modal" role="dialog" aria-modal="true" aria-label="重新开始"><div className="confirm"><h2>重新设定这段人生？</h2><p>当前故事会保留到本地存档中，但页面将回到开局选择，并开始一份新故事。</p><button onClick={()=>setConfirm(false)}>继续阅读</button><button className="primary" onClick={restartSelection}>重新设定 →</button></div></div>}
 </main>;
}
