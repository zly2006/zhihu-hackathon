'use client';
import {useCallback,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {PublicState,GameEvent,Gender,StoryBackground} from '../lib/story';
import {cast,chooseDemo,demoOpening,isSaveSlot,type CastId,type Chats,type SaveSlot} from '../lib/ui-story';
type ViewNode={title?:string;lines:{speaker:string;text:string}[];choices:{text:string}[]};
type UiCharacter={id:string;name:string;job:string;color:string;greeting:string;gender?:string};
type PoolMember={id:string;name:string;gender:Gender;age:number;identity:string};
type ProfileEdit={background:string;zhihuHandle:string};
type LiveCatalog={pool:PoolMember[];backgrounds:StoryBackground[];requiredCastCount:number;maxStages:number;defaultBackgroundId:string};
type AuthStatus={configured:boolean;authorized:boolean;profile:{name:string|null;avatarUrl:string|null;headline:string|null;url:string|null}|null;error:{code:string;message:string}|null};
const LOGIN_REQUIRED='知乎登录已失效，请重新登录后继续。';
const assetFor=(id:string,pose:CharacterPose='happy')=>`/art/${({lin:'f1',tao:'f2',shen:'f3'} as Record<string,string>)[id]||id}_${pose}.webp`;
type CharacterPose='normal'|'happy'|'playful'|'surprised'|'thinking';
const explicitPose=(text:string):CharacterPose|undefined=>text.match(/^\s*[（(](happy|normal|playful|surprised|thinking)[）)]\s*/i)?.[1].toLowerCase() as CharacterPose|undefined;
const visibleText=(text:string)=>text.replace(/^\s*[（(](happy|normal|playful|surprised|thinking)[）)]\s*/i,'');
const poseForText=(speaker:string,text:string):CharacterPose=>{
  const marked=explicitPose(text);if(marked)return marked;
  if(speaker==='旁白')return 'normal';
  if(/[?？]|怎么|为什么|疑惑|思考|考虑/.test(text))return 'thinking';
  if(/[!！]|突然|竟然|真的吗|诶|啊/.test(text))return 'surprised';
  if(/嘿嘿|调皮|眨眼|开玩笑|耍赖/.test(text))return 'playful';
  if(/开心|高兴|谢谢|太好了|喜欢|愿意|好啊|没问题|成功|期待|笑|温暖|轻松/.test(text))return 'happy';
  return 'normal';
};
const poseForLine=(line:{speaker:string;text:string}):CharacterPose=>poseForText(line.speaker,line.text);
const lastPoseForSpeaker=(lines:{speaker:string;text:string}[],speaker:string,index:number):CharacterPose=>{
  for(let cursor=Math.min(index,lines.length-1);cursor>=0;cursor-=1){
    if(lines[cursor]?.speaker===speaker)return poseForLine(lines[cursor]);
  }
  return 'normal';
};
const isPlayerSpeaker=(speaker:string,playerName:string)=>speaker==='我'||speaker==='许澄'||speaker===playerName;
const lastPoseForPlayer=(lines:{speaker:string;text:string}[],playerName:string,index:number):CharacterPose=>{
  for(let cursor=Math.min(index,lines.length-1);cursor>=0;cursor-=1){
    if(isPlayerSpeaker(lines[cursor]?.speaker||'',playerName))return poseForLine(lines[cursor]);
  }
  return 'normal';
};
const fallbackCharacter:UiCharacter={id:'lin',name:'林见夏',job:'插画师',color:'#bd7d91',greeting:'雨还没停。你想聊些什么？我在听。'};
type Panel='menu'|'history'|'save'|'load'|'settings'|'title'|'skip'|'setup'|null;
type BgmId='bgm05'|'bgm06'|'bgm08';
type Preferences={speed:number;delay:number;opacity:number;fontSize:number;motion:boolean;bgm:'random'|BgmId};
const bgmTracks:{id:BgmId;label:string;src:string}[]=[
  {id:'bgm05',label:'BGM 05 · 雨夜相遇',src:'/bgm/bgm05.opus'},
  {id:'bgm06',label:'BGM 06 · 安静靠近',src:'/bgm/bgm06.opus'},
  {id:'bgm08',label:'BGM 08 · 留一盏灯',src:'/bgm/bgm08.opus'},
];
const bgmIds=new Set<string>(bgmTracks.map(track=>track.id));
const defaults:Preferences={speed:35,delay:3,opacity:86,fontSize:25,motion:true,bgm:'random'};
const paths:Record<string,ReactNode>={menu:<path d="M4 6h16M4 12h16M4 18h16"/>,save:<><path d="M5 3h12l4 4v14H3V3z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/></>,load:<path d="M3 19V5h6l2 3h10v3M3 19l3-8h16l-3 8z"/>,history:<><path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/><path d="M12 7v5l3 2"/></>,play:<path d="m8 4 12 8-12 8z"/>,pause:<path d="M8 5v14M16 5v14"/>,fast:<path d="m3 5 9 7-9 7zM13 5l9 7-9 7z"/>,skip:<path d="m4 5 11 7-11 7zM19 5v14"/>,chat:<path d="M21 11a9 8 0 0 1-9 8H5l-4 3 2-7a8 8 0 0 1 0-8 9 8 0 0 1 18 4ZM7 10h.01M12 10h.01M17 10h.01"/>,settings:<><path d="m10 3-1 3-3 1-3-1-1 4 3 2v3l-2 2 3 3 3-1 3 2 3-1 2-3 3-1v-4l-3-2-1-3-4-1z"/><circle cx="12" cy="12" r="3"/></>,close:<path d="m6 6 12 12M18 6 6 18"/>,full:<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/>,heart:<path d="M12 21 3 12C-2 5 7 0 12 7c5-7 14-2 9 5z"/>,pin:<><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/></>,arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>};
function Icon({name}:{name:string}){return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.menu}</svg>;}
function Control({icon,children,...props}:{icon:string;children?:ReactNode}&React.ButtonHTMLAttributes<HTMLButtonElement>){return <button {...props}><Icon name={icon}/>{children}</button>;}
function readLocal(key:string){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function track(type:string,payload:Record<string,unknown>={},storyId?:string){void fetch('/api/interaction-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,...(storyId?{storyId}: {})})}).catch(()=>{});}
type ZhihuChoiceEvidence={contentId:string;title:string;author:string;url:string;authorAvatarUrl?:string;authorProfileUrl?:string};
function ZhihuAuthorAvatar({evidence}:{evidence:ZhihuChoiceEvidence}){
  const [failed,setFailed]=useState(false);
  const initial=[...evidence.author.trim()][0]||'知';
  if(!evidence.authorAvatarUrl||failed)return <span className="choice-source-fallback" aria-hidden="true">{initial}</span>;
  return <img src={evidence.authorAvatarUrl} alt="" loading="lazy" onError={()=>setFailed(true)}/>;
}
function ZhihuChoiceEvidence({evidence}:{evidence:ZhihuChoiceEvidence[]}){
  if(!evidence.length)return null;
  return <div className="choice-sources" aria-label="参考知乎答主">
    <span className="choice-sources-label">知乎用户也这么选了</span>
    {evidence.slice(0,3).map((item)=><a className="choice-source" key={item.contentId||item.url} href={item.url} target="_blank" rel="noreferrer noopener" title={`查看${item.author}的知乎回答`} aria-label={`${item.author}：查看知乎回答`}>
      <span className="choice-source-avatar"><ZhihuAuthorAvatar evidence={item}/></span><span className="choice-source-name">{item.author}</span>
    </a>)}
  </div>;
}

export default function Home(){
  const [state,setState]=useState<PublicState|null>(null),[partial,setPartial]=useState<ViewNode|null>(null);
  const [mode,setMode]=useState<'demo'|'live'>('live'),[started,setStarted]=useState(false),[ready,setReady]=useState(false);
  const [auth,setAuth]=useState<AuthStatus|null>(null),[authBusy,setAuthBusy]=useState(false);
  const [line,setLine]=useState(0),[shown,setShown]=useState(0),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [panel,setPanel]=useState<Panel>(null),[chatOpen,setChatOpen]=useState(false),[chatPerson,setChatPerson]=useState<CastId>('lin');
  const [chats,setChats]=useState<Chats>({}),[input,setInput]=useState(''),[chatBusy,setChatBusy]=useState(false),[chatError,setChatError]=useState('');
  const [preferences,setPreferences]=useState<Preferences>(defaults),[slots,setSlots]=useState<(SaveSlot|null)[]>(Array(6).fill(null));
  const [bgmTrack,setBgmTrack]=useState<BgmId|null>(null);
  const [playMode,setPlayMode]=useState<'manual'|'auto'|'fast'>('manual'),[hidden,setHidden]=useState(false),[toast,setToast]=useState(''),[affinity,setAffinity]=useState('');
  const [overwrite,setOverwrite]=useState<number|null>(null),[pageVisible,setPageVisible]=useState(true);
  const [liveCatalog,setLiveCatalog]=useState<LiveCatalog>({pool:[],backgrounds:[],requiredCastCount:4,maxStages:7,defaultBackgroundId:'university'});
  const [catalogReady,setCatalogReady]=useState(false);
  const [setupStep,setSetupStep]=useState(0),[selectedIds,setSelectedIds]=useState<string[]>([]),[profiles,setProfiles]=useState<Record<string,ProfileEdit>>({});
  const [selectedBackgroundId,setSelectedBackgroundId]=useState('university'),[playerName,setPlayerName]=useState('许澄'),[playerGender,setPlayerGender]=useState<Gender>('女');
  const busyRef=useRef(false),storyId=useRef<string|undefined>(undefined),chatLock=useRef(false),dialogRef=useRef<HTMLDialogElement>(null),chatRef=useRef<HTMLDialogElement>(null),chatEnd=useRef<HTMLDivElement>(null),audioRef=useRef<HTMLAudioElement>(null);
  const node=partial||state?.nodes.at(-1)||null,currentLine=node?.lines[line],rawText=currentLine?.text||'',text=visibleText(rawText);
  const fullyShown=shown>=text.length,atEnd=!!node&&line>=node.lines.length-1;
  const waiting=!!partial||!!state?.pending,paused=!!panel||chatOpen||hidden||!pageVisible||!started;
  const liveCast=(state?.world.cast||[]).map((c)=>({id:c.id,name:c.name,job:c.identity,color:'#9a83ad',greeting:`${c.name}此刻安静地看着你。`,gender:c.gender}));
  const uiCast:UiCharacter[]=liveCast.length?liveCast:[...cast];
  const partner=uiCast.find(c=>c.name===currentLine?.speaker)||uiCast.find(c=>c.id===state?.route)||uiCast[0]||fallbackCharacter;
  const chatCharacter=uiCast.find(c=>c.id===chatPerson)||partner||fallbackCharacter;
  const showChoices=atEnd&&fullyShown&&!waiting&&!busy&&!!node?.choices.length;
  const partnerPose=partner&&node?lastPoseForSpeaker(node.lines,partner.name,line):'normal';
  const activePlayerName=state?.world.player.name||'许澄';
  const playerPose=node?lastPoseForPlayer(node.lines,activePlayerName,line):'normal';
  const playerArtId=state?.world.player.gender==='女'?'f4':'m4';
  const playerSpeaking=isPlayerSpeaker(currentLine?.speaker||'',activePlayerName);
  const segment=(state?.nodes.length||0)+(partial?1:0);
  function notify(message:string){setToast(message);}
  function pickBgm(){const preferred=preferences.bgm;if(preferred==='random'){const choices=bgmTracks.filter(track=>track.id!==bgmTrack);const pool=choices.length?choices:bgmTracks;setBgmTrack(pool[Math.floor(Math.random()*pool.length)].id);}else setBgmTrack(preferred);}
  function requireLogin(){setAuth((current)=>current?{...current,authorized:false,profile:null}:current);setChatOpen(false);setStarted(false);setPanel(null);setError('');notify(LOGIN_REQUIRED);}
  function persist(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{notify('浏览器存储空间不足，进度暂未保存。');return false;}}
  useEffect(()=>{
    const p=readLocal('lamplight_preferences');if(p){const savedBgm=typeof p.bgm==='string'&&(['random',...bgmTracks.map(track=>track.id)] as string[]).includes(p.bgm)?p.bgm:'random';setPreferences({speed:Math.min(80,Math.max(0,Number(p.speed)||0)),delay:Math.min(8,Math.max(1,Number(p.delay)||3)),opacity:Math.min(100,Math.max(55,Number(p.opacity)||86)),fontSize:Math.min(31,Math.max(21,Number(p.fontSize)||25)),motion:p.motion!==false,bgm:savedBgm as Preferences['bgm']});}
    const saved=readLocal('lamplight_slots');if(Array.isArray(saved))setSlots(Array.from({length:6},(_,i)=>isSaveSlot(saved[i])?saved[i]:null));
    const auto=readLocal('lamplight_resume');
    if(isSaveSlot(auto)){setState(auto.state);setLine(Math.min(auto.line,Math.max(0,(auto.state.nodes.at(-1)?.lines.length||1)-1)));setMode(auto.mode);setChats(auto.chats);storyId.current=auto.storyId;setBgmTrack(typeof auto.bgm==='string'&&bgmIds.has(auto.bgm)?auto.bgm as BgmId:bgmTracks[Math.floor(Math.random()*bgmTracks.length)].id);setSelectedIds(auto.state.world.cast.map((member)=>member.id));setSelectedBackgroundId(auto.state.world.background.id);setPlayerName(auto.state.world.player.name);setPlayerGender(auto.state.world.player.gender);}
    else{const oldId=localStorage.getItem('lamplight_story_id');if(oldId){storyId.current=oldId;void fetch(`/api/story?storyId=${encodeURIComponent(oldId)}`).then(r=>r.json()).then(d=>{if(d.state){setState(d.state);setPartial(d.state.partial);setMode('live');}}).catch(()=>setError('旧存档读取失败，请稍后重试。'));}}
    void fetch('/api/story').then(r=>r.json()).then(d=>{const catalog={pool:d.pool||[],backgrounds:d.backgrounds||[],requiredCastCount:d.requiredCastCount||4,maxStages:d.maxStages||7,defaultBackgroundId:d.defaultBackgroundId||'university'};const available=new Set(catalog.pool.map((member:PoolMember)=>member.id));setLiveCatalog(catalog);setSelectedBackgroundId(catalog.defaultBackgroundId);setSelectedIds((current)=>{const valid=current.filter((id)=>available.has(id));return valid.length===current.length?valid:[];});setCatalogReady(catalog.pool.length>=catalog.requiredCastCount);}).catch(()=>setCatalogReady(false));
    const oauth=new URLSearchParams(window.location.search).get('oauth');
    void fetch('/api/auth/me',{cache:'no-store'}).then(r=>r.json()).then((payload:AuthStatus)=>{setAuth(payload);if(oauth==='success')notify('知乎登录成功，可以开始故事了。');if(oauth==='error')notify(payload.error?.message||'知乎登录没有完成，请重新登录。');}).catch(()=>setAuth({configured:false,authorized:false,profile:null,error:{code:'AUTH_UNAVAILABLE',message:'知乎登录状态暂时无法读取。'}}));
    setReady(true);
  },[]);
  useEffect(()=>{const audio=audioRef.current;if(!audio||!bgmTrack)return;const track=bgmTracks.find(item=>item.id===bgmTrack);if(!track)return;const source=new URL(track.src,window.location.href).href;if(audio.src!==source){audio.src=source;audio.load();}audio.loop=true;const shouldPlay=started&&!state?.complete&&!showChoices;if(shouldPlay){void audio.play().catch(()=>setToast('浏览器阻止了自动播放，请点击对白区域开启背景音乐。'));}else{audio.pause();if(state?.complete)audio.currentTime=0;}},[bgmTrack,started,state?.complete,showChoices]);
  useEffect(()=>{if(ready)persist('lamplight_preferences',preferences);},[preferences,ready]);
  useEffect(()=>{if(ready&&started&&state&&!waiting&&!busy)persist('lamplight_resume',{version:1,mode,storyId:storyId.current,state,line,chats,time:new Date().toISOString(),partner:partner.id,bgm:bgmTrack||undefined} satisfies SaveSlot);},[state,line,chats,mode,ready,started,waiting,busy,partner.id,bgmTrack]);
  useEffect(()=>{const audio=audioRef.current;if(!audio||!bgmTrack)return;const track=bgmTracks.find(item=>item.id===bgmTrack);if(!track)return;const source=new URL(track.src,window.location.href).href;if(audio.src!==source){audio.src=source;audio.load();}audio.loop=true;const shouldPlay=started&&!state?.complete&&!showChoices;if(shouldPlay)void audio.play().catch(()=>setToast('浏览器阻止了自动播放，请点击对白区域开启背景音乐。'));else{audio.pause();if(state?.complete)audio.currentTime=0;}},[bgmTrack,started,state?.complete,showChoices]);
  useEffect(()=>{const listener=()=>setPageVisible(!document.hidden);document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3300);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!affinity)return;const timer=setTimeout(()=>setAffinity(''),2800);return()=>clearTimeout(timer);},[affinity]);
  useEffect(()=>{setShown(preferences.motion&&preferences.speed?0:text.length);},[text,line]);
  useEffect(()=>{if(paused||fullyShown)return;if(!preferences.motion||preferences.speed===0||playMode==='fast'){setShown(text.length);return;}const timer=setInterval(()=>setShown(s=>Math.min(text.length,s+1)),1000/preferences.speed);return()=>clearInterval(timer);},[text,paused,fullyShown,preferences.motion,preferences.speed,playMode]);
  const advance=useCallback(()=>{if(paused||!node)return;if(!fullyShown){setShown(text.length);return;}if(line<node.lines.length-1){setLine(l=>l+1);setShown(0);}},[paused,node,fullyShown,text,line]);
  useEffect(()=>{if(paused||playMode==='manual'||atEnd||(!fullyShown&&playMode!=='fast'))return;const timer=setTimeout(advance,playMode==='fast'?150:preferences.delay*1000);return()=>clearTimeout(timer);},[paused,playMode,atEnd,fullyShown,preferences.delay,advance]);
  useEffect(()=>{if(atEnd&&!waiting)setPlayMode('manual');},[atEnd,waiting]);
  useEffect(()=>{if(panel)dialogRef.current?.showModal();else{dialogRef.current?.close();setOverwrite(null);}},[panel]);
  useEffect(()=>{if(chatOpen)chatRef.current?.showModal();else chatRef.current?.close();},[chatOpen]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({block:'nearest'});},[chats,chatBusy,chatOpen]);
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('此浏览器不支持全屏，请使用横屏浏览。');}}
  useEffect(()=>{const listener=(event:KeyboardEvent)=>{if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable=true]'))return;if(event.key==='Escape'){event.preventDefault();if(chatOpen)setChatOpen(false);else if(panel)setPanel(null);else if(hidden)setHidden(false);else setPanel('menu');return;}if(event.repeat)return;if(!paused&&!(event.target instanceof HTMLButtonElement)&&[' ','ArrowRight','Enter'].includes(event.key)){event.preventDefault();advance();}if(!panel&&!chatOpen&&event.key.toLowerCase()==='h')setHidden(v=>!v);if(event.key.toLowerCase()==='f')void fullscreen();};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);});

  async function act(action:'start'|'restart'|'retry'|'choose',choice?:number){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setStatus('雨还在下，故事正在继续…');setPlayMode('manual');const previous=state?.worldState.relationships;
    try{
      let selectedProfiles:({id:string;name:string;gender:Gender;background?:string;zhihuHandle?:string}|null)[]|undefined;
      if(action==='start'||action==='restart'){
        const profilesForStart=selectedIds.map((id)=>{const member=liveCatalog.pool.find((candidate)=>candidate.id===id);return member?{id:member.id,name:member.name,gender:member.gender,...(profiles[id]||{})}:null;});
        if(profilesForStart.some((profile)=>!profile)||profilesForStart.length!==liveCatalog.requiredCastCount){
          setStarted(false);setPanel('setup');setSetupStep(1);setError('角色列表已更新，请重新确认四位同行者。');notify('请重新确认四位同行者后再开始。');return;
        }
        selectedProfiles=profilesForStart;
      }
      const response=await fetch('/api/story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:action==='start'||action==='restart'?undefined:storyId.current,action,...(choice!==undefined?{choice,expected:state?.nodes.length}:{}),...(['start','restart'].includes(action)?{profiles:selectedProfiles,backgroundId:selectedBackgroundId,player:{name:playerName.trim(),gender:playerGender}}:{})})});
      const id=response.headers.get('X-Story-Id');if(id){storyId.current=id;localStorage.setItem('lamplight_story_id',id);}
      if(response.status===401){requireLogin();return;}
      if(!response.ok){const d=await response.json();throw new Error(d.error||'故事暂时无法继续。');}
      if(!response.headers.get('content-type')?.includes('text/event-stream')){const d=await response.json();setState(d.state);setPartial(d.state?.partial||null);return;}
      const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
      const receive=(event:GameEvent)=>{
        if(event.type==='status')setStatus(event.message);
        if(event.type==='scene'){setPartial({title:event.title,lines:[],choices:[]});setLine(0);setShown(0);}
        if(event.type==='line')setPartial(old=>{const next={...(old||{lines:[],choices:[]}),lines:[...(old?.lines||[])]};next.lines[event.index]={speaker:event.speaker,text:event.text};return next;});
        if(event.type==='choices')setPartial(old=>old?{...old,choices:event.items}:old);
        if(event.type==='done'){setState(event.state);setPartial(null);finished=true;for(const c of (event.state.world.cast||[])){const delta=event.state.worldState.relationships[c.id]-(previous?.[c.id]||0);if(delta>0)setAffinity(`${c.name}  ♥ +${delta}`);}}
        if(event.type==='error')throw new Error(event.message);
      };
      try{while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});const rows=buffer.split('\n');buffer=rows.pop()||'';for(const row of rows)if(row.startsWith('data:'))receive(JSON.parse(row.slice(5)));if(chunk.done){if(buffer.startsWith('data:'))receive(JSON.parse(buffer.slice(5)));break;}}}finally{await reader.cancel().catch(()=>{});}
      if(!finished)throw new Error('连接中断，已收到的对白仍会保留。');
    }catch(e){setError(e instanceof Error?e.message:'故事暂时无法继续。');if(storyId.current)try{const r=await fetch(`/api/story?storyId=${storyId.current}`),d=await r.json();if(d.state){setState(d.state);setPartial(d.state.partial||null);}}catch{}}
    finally{busyRef.current=false;setBusy(false);setStatus('');}
  }
  function startLogin(){track('ui_login_clicked');setAuthBusy(true);window.location.assign('/api/auth/login');}
  async function logout(){setAuthBusy(true);try{await fetch('/api/auth/logout',{method:'POST'});track('ui_logout_clicked');setAuth({configured:true,authorized:false,profile:null,error:null});setStarted(false);setState(null);setPartial(null);setPanel(null);notify('已退出知乎登录。');}finally{setAuthBusy(false);}}
  function startDemo(){if(!auth?.authorized){notify('请先登录知乎。');return;}track('ui_demo_started');pickBgm();setState(structuredClone(demoOpening));setMode('demo');setPartial(null);setLine(0);setShown(0);setChats({});setError('');setStarted(true);setPanel(null);storyId.current=undefined;}
  function openSetup(){if(!auth?.authorized){notify('请先登录知乎。');return;}setSelectedIds([]);setProfiles({});setError('');setSetupStep(0);setPanel('setup');}
  function toggleMember(id:string){setSelectedIds((current)=>{if(current.includes(id))return current.filter((item)=>item!==id);if(current.length>=liveCatalog.requiredCastCount){notify(`已经选满${liveCatalog.requiredCastCount}位，请先取消一位再更换。`);return current;}return [...current,id];});}
  function updateProfile(id:string,key:keyof ProfileEdit,value:string){setProfiles((current)=>({...current,[id]:{background:current[id]?.background||'',zhihuHandle:current[id]?.zhihuHandle||'',[key]:value}}));}
  function canAdvanceSetup(){if(setupStep===0)return Boolean(selectedBackgroundId);if(setupStep===1)return catalogReady&&selectedIds.length===liveCatalog.requiredCastCount&&selectedIds.every((id)=>liveCatalog.pool.some((member)=>member.id===id));return catalogReady&&selectedIds.length===liveCatalog.requiredCastCount&&playerName.trim().length>0;}
  function nextSetup(){if(!auth?.authorized){notify('请先登录知乎。');return;}if(!canAdvanceSetup())return;track('ui_setup_step',{step:setupStep});if(setupStep<2){setSetupStep((step)=>step+1);return;}if(selectedIds.length!==liveCatalog.requiredCastCount||selectedIds.some((id)=>!liveCatalog.pool.some((member)=>member.id===id))){setSetupStep(1);setPanel('setup');notify('角色列表刚刚更新，请重新确认四位同行者。');return;}pickBgm();setPanel(null);setMode('live');setState(null);setPartial(null);setLine(0);setChats({});setStarted(true);storyId.current=undefined;void act('start');}
  function choose(index:number){if(!auth?.authorized){notify('请先登录知乎。');return;}if(busy||waiting||!state)return;track('ui_choice_clicked',{choice:index},storyId.current);if(mode==='live'){void act('choose',index);return;}const next=chooseDemo(state,index);for(const c of cast){const delta=next.worldState.relationships[c.id]-state.worldState.relationships[c.id];if(delta>0)setAffinity(`${c.name}  ♥ +${delta}`);}setState(next);setLine(0);setShown(0);setPlayMode('manual');}
  async function saveSlot(index:number){
    if(!auth?.authorized){notify('请先登录知乎。');return;}if(!state||waiting||busyRef.current)return;track('ui_save_clicked',{slot:index},storyId.current);if(slots[index]&&overwrite!==index){setOverwrite(index);return;}busyRef.current=true;setBusy(true);
    try{let id=storyId.current;if(mode==='live'){const r=await fetch('/api/saves',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:id})}),d=await r.json();if(!r.ok)throw new Error(d.error);id=d.storyId;}
      const next=[...slots];next[index]={version:1,mode,storyId:id,state:structuredClone(state),line,chats:structuredClone(chats),time:new Date().toISOString(),partner:partner.id,bgm:bgmTrack||undefined};if(persist('lamplight_slots',next)){setSlots(next);setOverwrite(null);notify(`已保存到位置 ${String(index+1).padStart(2,'0')}`);}
    }catch(e){notify(e instanceof Error?e.message:'存档失败，请重试。');}finally{busyRef.current=false;setBusy(false);}
  }
  async function loadSlot(slot:SaveSlot){
    if(!auth?.authorized){notify('请先登录知乎。');return;}if(busyRef.current)return;track('ui_load_clicked',{slot:slot.storyId},slot.storyId);busyRef.current=true;setBusy(true);
    try{let id=slot.storyId,loaded=slot.state;if(slot.mode==='live'){const r=await fetch('/api/saves',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:id})}),d=await r.json();if(!r.ok)throw new Error(d.error);id=d.storyId;loaded=d.state;}
      storyId.current=id;setBgmTrack(typeof slot.bgm==='string'&&bgmIds.has(slot.bgm)?slot.bgm as BgmId:bgmTracks[Math.floor(Math.random()*bgmTracks.length)].id);setState(structuredClone(loaded));setPartial(null);setMode(slot.mode);setLine(Math.min(slot.line,Math.max(0,(loaded.nodes.at(-1)?.lines.length||1)-1)));setShown(0);setChats(structuredClone(slot.chats));setError('');setPlayMode('manual');setStarted(true);setPanel(null);notify('已回到保存的那一刻');
    }catch(e){notify(e instanceof Error?e.message:'读档失败，请重试。');}finally{busyRef.current=false;setBusy(false);}
  }
  async function sendChat(){
    const message=input.trim();if(!message||chatLock.current)return;track('ui_chat_sent',{character:chatPerson,message});chatLock.current=true;setChatBusy(true);setChatError('');setInput('');const person=chatPerson;
    const conversation=[...(chats[person]||[]),{role:'user' as const,text:message}];setChats(v=>({...v,[person]:conversation}));
    try{let reply:string;if(mode==='demo'){reply=/画|工作|摄影|杯/.test(message)?`${person==='lin'?'画画有时候像聊天，不必急着找到标准答案。':person==='tao'?'每一只杯子都有自己的样子，歪一点也没关系。':'照片能留住一个瞬间，陪伴却需要慢慢来。'}你呢，今天有什么想留住的小事吗？`:/雨|回家/.test(message)?'雨看起来小了一点。等你准备好了，我们再一起看看窗外吧。':'谢谢你愿意跟我说这些。不用急着把话说得很漂亮，我会认真听。';await new Promise(resolve=>setTimeout(resolve,550));}
      else{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:storyId.current,character:person,line,messages:conversation.slice(-12)})}),d=await r.json();if(r.status===401){requireLogin();throw new Error(LOGIN_REQUIRED);}if(!r.ok)throw new Error(d.error||'暂时无法连接，请稍后再试。');reply=d.text;}
      setChats(v=>({...v,[person]:[...(v[person]||[]),{role:'assistant',text:reply}]}));
    }catch(e){setChats(v=>({...v,[person]:(v[person]||[]).slice(0,-1)}));setInput(message);setChatError(e instanceof Error?e.message:'发送失败，消息已保留。');}finally{chatLock.current=false;setChatBusy(false);}
  }

  const historyNodes=[...(state?.nodes||[]),...(partial?[partial]:[])];
  const css={'--panel-opacity':preferences.opacity/100,'--dialogue-size':`${preferences.fontSize/16}cqw`,'--character-accent':partner.color} as CSSProperties;
  const sceneAsset=state?.world.background.sceneAsset||'/art/cafe-rain.webp';
  return <main className={`game-shell ${preferences.motion?'':'reduce-motion'}`}>
    <div className="portrait-notice"><span>↻</span><h2>把屏幕横过来，故事就开始了。</h2><p>横屏体验 · 留一盏灯</p></div>
    <section className="game-stage" style={css} aria-label="留一盏灯，视觉小说舞台" onContextMenu={e=>{if(!(e.target instanceof HTMLElement&&e.target.closest('input,textarea'))){e.preventDefault();if(!chatOpen)setPanel(panel?null:'menu');}}}>
      <img className="background" src={sceneAsset} alt={state?.world.background.label||"雨夜场景"}/><audio className="bgm-audio" ref={audioRef} preload="auto" aria-label="背景音乐"/><div className="scene-vignette"/><div className="rain-light" aria-hidden="true"/>
      <div className={`cast-stage ${started?'':'title-cast'}`} aria-hidden={!started}><img key={`${playerArtId}-${playerPose}`} className={`character player pose-${playerPose} ${playerSpeaking?'speaking':''}`} src={assetFor(playerArtId,playerPose)} alt={`主角${activePlayerName}的立绘`}/><img key={`${partner.id}-${partnerPose}`} className={`character partner pose-${partnerPose} ${currentLine?.speaker===partner.name?'speaking':''}`} src={assetFor(partner.id,partnerPose)} alt={`${partner.name}的立绘`}/></div>
      {started&&!hidden&&<>
        <header className="stage-header"><div className="wordmark"><span className="zhihu-mark">知乎 <i>×</i> GALGAME</span><h1>留一盏灯<span>✧</span></h1><span className="wordmark-en">A LIGHT LEFT FOR YOU</span></div><div className="top-right"><span className="chapter-chip">{mode==='demo'?'体验篇':'故事篇'} · {String(segment||1).padStart(2,'0')} / {String(state?.total||7).padStart(2,'0')}</span><Control icon="menu" className="menu-trigger" aria-label="打开游戏菜单" onClick={()=>setPanel('menu')}/></div></header>
        <div className="location-chip"><Icon name="pin"/>{state?.world.locations[0]||'工作室前厅'}<span>雨夜</span></div><div className="chapter-side"><span>CHAPTER {String(segment||1).padStart(2,'0')}</span><i/>{node?.title||'故事即将开始'}</div>
        {showChoices&&<div className="choice-layer"><div className="choice-card"><span className="eyebrow">{state?.stageKind==='common'?'ROUTE A · 选择同行者':'LIFE B · 人生选择'}</span><h2>{state?.stageKind==='common'?'我想和谁一起走下去？':'这一次，我要怎么面对？'}</h2>{node?.choices.map((choice,i)=><div className="choice-option" key={i}><button onClick={()=>choose(i)} data-choice={i}><span>0{i+1}</span>{choice.text}<Icon name="arrow"/></button>{state?.stageKind==='route'&&<ZhihuChoiceEvidence evidence={state.lifeEvent?.options[i]?.evidence||[]}/>}</div>)}</div></div>}
        <div className="dialogue-wrap"><div className="speaker-name"><span className="speaker-spark">✦</span>{currentLine?.speaker||'旁白'}<span className="speaker-role">{currentLine?.speaker==='许澄'?'你':uiCast.find(c=>c.name===currentLine?.speaker)?.job||'STORY'}</span></div><div className="dialogue-panel"><button className="dialogue-click" aria-label="推进对白" onClick={advance} disabled={!node||!!panel||chatOpen}><span className="dialogue-text">{text.slice(0,shown)||(!text?(busy?'第一句话正在到来，请稍候…':error?'雨夜暂时停在了这里。':'正在打开这一页…'):'\u00a0')}</span><span className="dialogue-bottom"><span>{busy||waiting?'故事正在继续…':showChoices?'选择你的回应':atEnd&&state?.complete?'FIN · 谢谢你，留到了最后。':'点击空白处继续 · SPACE'}</span><span>{String(line+1).padStart(2,'0')}<i> / </i>{String(node?.lines.length||0).padStart(2,'0')}</span></span>{fullyShown&&!atEnd&&<span className="continue-diamond">◆</span>}</button><div className="dialogue-aside"><span className="aside-spark">✧</span><p>故事之外<br/>还有话想对你说</p><Control icon="chat" className="chat-entry" disabled={!node||busy} onClick={()=>{setChatPerson(partner.id);setChatOpen(true);}}>和{partner.name}聊聊</Control><span className="pause-note">属于你们的片刻</span></div></div></div>
        <footer className="quick-menu"><span className="save-status"><i/>{mode==='demo'?'示例剧情':'实时剧情'}<span> · </span>{busy?'正在续写':waiting?'等待续写':'进度自动保存'}</span><nav aria-label="剧情快捷操作"><Control icon="history" onClick={()=>setPanel('history')}>回看</Control><Control icon={playMode==='auto'?'pause':'play'} aria-pressed={playMode==='auto'} disabled={!node||atEnd} onClick={()=>setPlayMode(p=>p==='auto'?'manual':'auto')}>自动</Control><Control icon="fast" aria-pressed={playMode==='fast'} title="快速播放当前片段，在选择前停止" disabled={!node||atEnd} onClick={()=>setPlayMode(p=>p==='fast'?'manual':'fast')}>快进</Control><Control icon="skip" disabled={!node||atEnd||waiting} onClick={()=>setPanel('skip')}>跳过</Control><span className="toolbar-divider"/><Control icon="save" disabled={!state||waiting||busy} onClick={()=>setPanel('save')}>存档</Control><Control icon="load" disabled={busy} onClick={()=>setPanel('load')}>读档</Control><Control icon="settings" onClick={()=>setPanel('settings')}>设置</Control><Control icon="eye" aria-label="隐藏界面" onClick={()=>setHidden(true)}/><Control icon="full" aria-label="切换全屏" onClick={()=>void fullscreen()}/></nav></footer>
        {(error||(waiting&&!busy))&&<div className="story-error" role="alert"><span>{error||'上次的故事尚未写完。'}</span><button disabled={busy} onClick={()=>void act('retry')}>重试续写</button><button disabled={busy} onClick={()=>setPanel('title')}>返回标题</button></div>}{busy&&status&&<div className="generation-status" role="status">{status}</div>}{atEnd&&fullyShown&&state?.complete&&<button className="ending-button" onClick={()=>setPanel('title')}>{state.ending?.label||'故事终章'} · {state.ending?.summary||'再次相遇'} <Icon name="arrow"/></button>}
      </>}
      {started&&hidden&&<button className="restore-ui" onClick={()=>setHidden(false)}>显示界面 · H</button>}
      {!started&&<div className="title-screen"><div className="title-copy"><span className="zhihu-mark">知乎 <i>×</i> GALGAME</span><p className="title-overline">SOME ENCOUNTERS FEEL LIKE COMING HOME</p><h1>留一盏灯<span>✧</span></h1><p className="title-en">A LIGHT LEFT FOR YOU</p><p className="title-poem">雨声把世界隔在窗外。<br/>而你，刚好留了下来。</p><div className="title-actions">{auth?.authorized?<>{state&&<button className="primary" disabled={!ready} onClick={()=>setStarted(true)}>继续故事 <Icon name="arrow"/></button>}<button className={state?'':'primary'} disabled={!ready||busy} onClick={openSetup}>开始正式故事 <Icon name="arrow"/></button><button disabled={!ready||busy} onClick={startDemo}>体验预览 <span>○</span></button></>:<button className="primary" disabled={!ready||!auth?.configured||authBusy} onClick={startLogin}>{auth?.configured?'登录知乎开始游戏':'知乎登录未配置'} <Icon name="arrow"/></button>}<div className="title-secondary"><button disabled={!auth?.authorized} onClick={()=>setPanel('load')}>读取存档</button><i/><button onClick={()=>setPanel('settings')}>游戏设置</button>{auth?.authorized&&<><i/><button disabled={authBusy} onClick={()=>void logout()}>退出知乎</button></>}</div></div><p className="title-footnote">{auth?.authorized?`已登录知乎${auth.profile?.name?`：${auth.profile.name}`:''}。先选择你的人生阶段与同行者。`:auth?.configured?'进行游戏前必须先登录知乎。':'服务端尚未配置知乎 OAuth。'}</p></div><span className="title-version">LAMPLIGHT / INTERACTIVE VISUAL NOVEL</span></div>}
      {toast&&<div className="toast" role="status">{toast}</div>}{affinity&&<div className="affinity-toast" role="status">{affinity}</div>}
      <dialog ref={dialogRef} className={`game-dialog panel-${panel}`} onCancel={e=>{e.preventDefault();setPanel(null);}} onClick={e=>{if(e.target===e.currentTarget)setPanel(null);}} aria-label={panel==='setup'?'开始正式故事':panel==='history'?'回看故事':panel==='settings'?'游戏设置':panel==='save'?'保存故事':panel==='load'?'读取故事':'游戏菜单'}><div className="modal-card"><Control icon="close" className="modal-close" aria-label="关闭弹窗" onClick={()=>setPanel(null)}/><span className="eyebrow">LAMPLIGHT · {panel==='setup'?'NEW STORY':panel==='history'?'BACKLOG':panel==='settings'?'PREFERENCES':panel==='save'?'SAVE':panel==='load'?'LOAD':'PAUSE'}</span>
        {panel==='setup'&&<><h2>{setupStep===0?'先决定你要走哪一段人生':setupStep===1?'选择会改变故事的人':'最后，告诉故事你是谁'}</h2><p className="modal-description">{setupStep===0?'人生阶段决定事件、压力和关系线的现实边界。':setupStep===1?`从${liveCatalog.pool.length||8}位角色中选择${liveCatalog.requiredCastCount}位同行者，之后的共同篇会让每个人真正参与选择。`: '这些资料会进入生成提示词，影响角色如何理解你和彼此的关系。'}</p>{setupStep===0&&<div className="setup-backgrounds">{liveCatalog.backgrounds.map((background)=><button key={background.id} className={`setup-card ${selectedBackgroundId===background.id?'selected':''}`} onClick={()=>setSelectedBackgroundId(background.id)}><span>{background.ordinal}</span><strong>{background.label}</strong><small>{background.kicker}</small><p>{background.summary}</p></button>)}</div>}{setupStep===1&&<><div className="setup-selection-status" role="status">已选择 <strong>{selectedIds.length}</strong> / {liveCatalog.requiredCastCount} 位同行者{!catalogReady?<span> · 正在同步角色资料…</span>:selectedIds.length<liveCatalog.requiredCastCount?<span> · 请继续点击人物卡片</span>:<span> · 已选满，可以继续</span>}</div><div className="setup-cast-grid">{liveCatalog.pool.map((member)=>{const selectedOrder=selectedIds.indexOf(member.id);return <button type="button" key={member.id} aria-pressed={selectedOrder>=0} disabled={!catalogReady} className={`setup-cast ${selectedOrder>=0?'selected':''}`} onClick={()=>toggleMember(member.id)}><span className="setup-cast-mark">{selectedOrder>=0?selectedOrder+1:member.gender==='女'?'她':'他'}</span><span><strong>{member.name}</strong><small>{member.identity}</small></span><em>{member.age}岁</em></button>;})}</div><div className="setup-profile-list"><small>人物背景与知乎答主替身（可选）</small>{selectedIds.map((id)=>{const member=liveCatalog.pool.find((candidate)=>candidate.id===id);return member?<div className="setup-profile-row" key={id}><strong>{member.name}</strong><input aria-label={`${member.name}的人物背景`} value={profiles[id]?.background||''} maxLength={300} onChange={(event)=>updateProfile(id,'background',event.target.value)} placeholder="一句话人物背景"/><input aria-label={`${member.name}的知乎答主`} value={profiles[id]?.zhihuHandle||''} maxLength={80} onChange={(event)=>updateProfile(id,'zhihuHandle',event.target.value)} placeholder="知乎答主名（可选）"/></div>:null})}</div></>}{setupStep===2&&<div className="setup-player"><label>你的名字<input value={playerName} maxLength={16} onChange={(event)=>setPlayerName(event.target.value)} placeholder="例如：许澄"/></label><fieldset><legend>你的性别</legend><button type="button" className={playerGender==='女'?'selected':''} onClick={()=>setPlayerGender('女')}>女性</button><button type="button" className={playerGender==='男'?'selected':''} onClick={()=>setPlayerGender('男')}>男性</button></fieldset><div className="setup-notice"><span>✦</span><p>每一轮会先生成完整对白，再把选择交给你。关系线、人生事件和结局都会沿着你的选择推进。</p></div></div>}<div className="setup-footer"><span>0{setupStep+1} / 03</span><div><button disabled={setupStep===0} onClick={()=>setSetupStep((step)=>Math.max(0,step-1))}>上一步</button><button className="primary" disabled={!canAdvanceSetup()} onClick={nextSetup}>{setupStep===2?'开始生成':'继续'} <Icon name="arrow"/></button></div></div></>}
        {panel==='menu'&&<><h2>让这一刻，停留一下。</h2><div className="menu-grid"><Control icon="save" disabled={!state||waiting||busy} onClick={()=>setPanel('save')}>保存故事</Control><Control icon="load" disabled={busy} onClick={()=>setPanel('load')}>读取故事</Control><Control icon="history" disabled={!node} onClick={()=>setPanel('history')}>回看 · Backlog</Control><Control icon="settings" onClick={()=>setPanel('settings')}>游戏设置</Control><Control icon="full" onClick={()=>void fullscreen()}>切换全屏</Control><Control icon="arrow" disabled={busy} onClick={()=>setPanel('title')}>返回标题</Control></div><button className="primary modal-resume" onClick={()=>setPanel(null)}>继续这一刻</button></>}
        {panel==='history'&&<><h2>我们说过的话</h2><p className="modal-description">把已经走过的片刻，再温习一遍。</p><div className="backlog">{historyNodes.map((n,i)=><article key={i}><h3><span>0{i+1}</span>{n.title}</h3>{n.lines.slice(0,i===historyNodes.length-1?line+(fullyShown?1:0):undefined).map((l,j)=><p key={j}><b>{l.speaker}</b><span>{l.text}</span></p>)}</article>)}</div></>}
        {(panel==='save'||panel==='load')&&<><h2>{panel==='save'?'收藏这一刻':'回到那一刻'}</h2><p className="modal-description">{panel==='save'?'保存当前对白、选择与聊天记录。':'选择一个保存的位置，继续你们的故事。'}</p><div className="save-grid">{slots.map((slot,i)=><button key={i} className="save-slot" disabled={busy||(panel==='load'&&!slot)} aria-label={`${panel==='save'?'保存到':'读取'}位置 ${i+1}`} onClick={()=>panel==='save'?void saveSlot(i):slot&&void loadSlot(slot)}><span className="slot-number">0{i+1}</span>{slot?<><div className="slot-preview"><img src="/art/cafe-rain.webp" alt="存档场景"/><img className={`pose-${poseForText(slot.state.nodes.at(-1)?.lines?.[slot.line]?.speaker||'旁白',slot.state.nodes.at(-1)?.lines?.[slot.line]?.text||'')}`} src={assetFor(slot.partner,poseForText(slot.state.nodes.at(-1)?.lines?.[slot.line]?.speaker||'旁白',slot.state.nodes.at(-1)?.lines?.[slot.line]?.text||''))} alt=""/></div><strong>{overwrite===i?'再次点击确认覆盖':slot.state.nodes.at(-1)?.title}</strong><span>{slot.mode==='demo'?'体验篇':'AI 故事'} · 第 {slot.line+1} 句</span><time>{new Date(slot.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></>:<div className="slot-empty"><span>＋</span><p>尚未留下回忆</p></div>}</button>)}</div></>}
        {panel==='settings'&&<><h2>按照你的节奏</h2><div className="settings-list"><label>文字显示速度 <output>{preferences.speed===0?'立即显示':`${preferences.speed} 字 / 秒`}</output><input type="range" min="0" max="80" step="5" value={preferences.speed} onChange={e=>setPreferences(p=>({...p,speed:+e.target.value}))}/></label><label>自动阅读间隔 <output>{preferences.delay} 秒</output><input type="range" min="1" max="8" value={preferences.delay} onChange={e=>setPreferences(p=>({...p,delay:+e.target.value}))}/></label><label>对白框不透明度 <output>{preferences.opacity}%</output><input type="range" min="55" max="100" value={preferences.opacity} onChange={e=>setPreferences(p=>({...p,opacity:+e.target.value}))}/></label><label>对白字号 <output>{preferences.fontSize}</output><input type="range" min="21" max="31" value={preferences.fontSize} onChange={e=>setPreferences(p=>({...p,fontSize:+e.target.value}))}/></label><label>背景音乐 <select value={preferences.bgm} onChange={e=>setPreferences(p=>({...p,bgm:e.target.value as Preferences['bgm']}))}><option value="random">每个故事随机播放</option>{bgmTracks.map(track=><option key={track.id} value={track.id}>{track.label}</option>)}</select></label><label className="switch-label">界面动画与逐字显示 <input type="checkbox" checked={preferences.motion} onChange={e=>setPreferences(p=>({...p,motion:e.target.checked}))}/></label></div><p className="keyboard-help">空格 / → 推进　·　Esc 菜单　·　H 隐藏界面　·　F 全屏</p><button className="text-button" onClick={()=>setPreferences(defaults)}>恢复默认设置</button></>}
        {panel==='skip'&&<><h2>跳到这段故事的选择？</h2><p className="modal-description">跳过当前片段剩余的对白，在需要你做决定的地方停下。</p><div className="confirm-actions"><button onClick={()=>setPanel(null)}>慢慢读完</button><button className="primary" onClick={()=>{setLine(Math.max(0,(node?.lines.length||1)-1));setShown(10000);setPlayMode('manual');setPanel(null);}}>跳过本段</button></div></>}
        {panel==='title'&&<><h2>暂时告别这个雨夜？</h2><p className="modal-description">阅读位置会自动保留，随时可以回来继续。</p><div className="confirm-actions"><button onClick={()=>setPanel(null)}>再待一会儿</button><button className="primary" disabled={busy} onClick={()=>{setStarted(false);setPanel(null);setPlayMode('manual');}}>返回标题</button></div></>}
      </div></dialog>
      <dialog ref={chatRef} className="chat-dialog" aria-label="自由对话" onCancel={e=>{e.preventDefault();setChatOpen(false);}} onClick={e=>{if(e.target===e.currentTarget)setChatOpen(false);}}><aside className="chat-panel"><header className="chat-header"><div className="chat-avatar"><img src={assetFor(chatPerson,'happy')} alt=""/></div><div><h2>{chatCharacter.name}</h2><span><i/>{chatCharacter.job} · 正在你身边</span></div><Control icon="close" aria-label="关闭自由对话" onClick={()=>setChatOpen(false)}/></header><div className="chat-tabs" aria-label="聊天对象">{uiCast.map(c=><button key={c.id} aria-pressed={chatPerson===c.id} disabled={chatBusy} onClick={()=>{setChatPerson(c.id);setChatError('');}}>{c.name}</button>)}</div><div className="relationship"><span><Icon name="heart"/>好感度</span><b>{state?.worldState.relationships[chatPerson]||0}</b><div role="meter" aria-label={`${chatCharacter.name}好感度`} aria-valuemin={0} aria-valuemax={Math.max(6,state?.worldState.relationships[chatPerson]||0)} aria-valuenow={state?.worldState.relationships[chatPerson]||0}><i style={{width:`${Math.min(100,(state?.worldState.relationships[chatPerson]||0)/6*100)}%`}}/></div></div><p className="chat-pause">Ⅱ 剧情已暂停，时间只属于你们</p><div className="chat-messages" role="log" aria-live="polite"><p className="chat-date">{mode==='demo'?'体验模式 · 预设角色回复':'故事之外的一次对话'}</p><div className="bubble assistant">{chatCharacter.greeting}</div>{(chats[chatPerson]||[]).map((m,i)=><div className={`bubble ${m.role}`} key={i}>{m.text}</div>)}{chatBusy&&<div className="bubble assistant typing">正在想怎么对你说…</div>}<div ref={chatEnd}/></div>{chatError&&<p className="chat-error" role="alert">{chatError}</p>}<form className="chat-form" onSubmit={e=>{e.preventDefault();void sendChat();}}><textarea aria-label={`想对${chatCharacter.name}说的话`} placeholder={`想对${chatCharacter.name}说些什么？`} maxLength={500} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void sendChat();}}}/><button type="submit" disabled={!input.trim()||chatBusy} aria-label="发送消息"><Icon name="arrow"/></button><span>Enter 发送 · Shift + Enter 换行</span></form></aside></dialog>
    </section>
  </main>;
}
