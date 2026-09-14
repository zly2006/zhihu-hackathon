import type {PublicState} from './story';

export const cast = [
  {id:'lin', name:'林见夏', job:'插画师', color:'#bd7d91', greeting:'雨还没停。你想聊些什么？我在听。'},
  {id:'tao', name:'陶晚晴', job:'陶艺师', color:'#86a99a', greeting:'来，捧着这只杯子暖暖手。今天过得怎么样？'},
  {id:'shen', name:'沈知遥', job:'摄影师', color:'#889ec6', greeting:'先把相机放下。现在，我想听你说。'},
] as const;
export type CastId = string;
export type ChatMessage = {role:'user'|'assistant';text:string};
export type Chats = Partial<Record<CastId,ChatMessage[]>>;
export type SaveSlot = {version:1;mode:'demo'|'live';storyId?:string;state:PublicState;line:number;chats:Chats;time:string;partner:CastId;bgm?:string};

export const demoOpening:PublicState = {
  storyTitle:'留一盏灯', storyTone:'雨夜、未说出口的话，和刚刚好的相遇',
  worldState:{relationships:{lin:0,tao:0,shen:0},flags:[],timeline:[],endingId:undefined},
  lifeEvent:null, relationshipProgress:[
    {id:'lin',name:'林见夏',affinity:0,disclosure:'尚未分享'},
    {id:'tao',name:'陶晚晴',affinity:0,disclosure:'尚未分享'},
    {id:'shen',name:'沈知遥',affinity:0,disclosure:'尚未分享'},
  ], selectedEvidence:[],
  world:{
    player:{id:'player',name:'许澄',gender:'男',age:25,identity:'自由撰稿人'},
    background:{id:'rainy-studio',label:'雨夜工作室',ordinal:'00',kicker:'雨声把世界隔在窗外',summary:'共享工作室的开放夜被一场雨留住。',sceneAsset:'/art/cafe-rain.webp',lifeChoice:{title:'留在这里',question:'你想把这一晚交给谁？',pressure:'雨还没有停。',directions:['整理画纸','摆好杯子','检查相机']},constraints:[]},
    premise:'共享工作室的周年开放夜，一场突如其来的雨，让四个人的故事悄悄开始。', locations:['工作室前厅','门口雨棚'],
    cast:[
      {id:'lin',name:'林见夏',gender:'女',age:25,identity:'插画师',background:undefined,zhihuHandle:undefined},
      {id:'tao',name:'陶晚晴',gender:'女',age:24,identity:'陶艺师',background:undefined,zhihuHandle:undefined},
      {id:'shen',name:'沈知遥',gender:'女',age:26,identity:'摄影师',background:undefined,zhihuHandle:undefined},
    ],
  },
  partial:null, ending:null, route:null, relationshipType:null, routeLabel:null, stageId:'demo-opening', stageKind:'common', selections:[], pending:false, total:3, minTotal:3, maxTotal:3, complete:false,
  nodes:[{title:'雨声里的相遇',readingSeconds:45,lines:[
    {speaker:'旁白',text:'雨点轻轻敲着玻璃，工作室里只剩下暖黄的灯光。原本热闹的周年夜，忽然有了安静下来的理由。'},
    {speaker:'林见夏',text:'（playful）先别急着走。外面雨这么大……陪我把最后一张画收好吧。'},
    {speaker:'许澄',text:'（thinking）好。靠窗的画纸也要收起来吗？我来帮你。'},
    {speaker:'林见夏',text:'（happy）嗯，小心右下角，那里还没干。今天的灯光很好，我有点舍不得收笔。'},
    {speaker:'陶晚晴',text:'（playful）那就慢一点。我刚泡好茶，杯沿虽然有点歪，喝起来可不影响。'},
    {speaker:'沈知遥',text:'（surprised）你们站在灯下的样子很好看。不过，拍照之前，我想先问问你们的意见。'},
    {speaker:'旁白',text:'我放下雨伞。画纸、温热的杯子，还有尚未按下快门的相机，都在等一个小小的回应。'},
  ],choices:[{text:'陪见夏整理窗边的画纸'},{text:'帮晚晴摆好手工杯'},{text:'和知遥一起检查相机'}]}],
};
export function chooseDemo(state:PublicState, index:number):PublicState {
  const next=structuredClone(state), person=cast[index]||cast[0];
  if(next.complete || !next.nodes.at(-1)?.choices[index]) return next;
  next.selections.push({node:next.nodes.length-1,index});
  if(next.nodes.length===1){
    next.route=person.id;next.worldState.relationships[person.id]+=2;
    const action={lin:'我把靠窗的画纸一张张移到干燥的桌面上，留出右下角还没干的颜料。',tao:'我接过托盘，把杯子放在桌子中央。歪歪的杯沿，在暖光下像一个小小的微笑。',shen:'我帮她把三脚架摆稳，试了试定时快门，又把镜头朝向大家都能看见的位置。'}[person.id];
    const reply={lin:'你真的记住了。我总觉得，肯认真看一张画的人，比画画的人还难遇到。',tao:'你没有把它换成那只更漂亮的。谢谢，我其实……一直很喜欢这只。',shen:'谢谢你没有躲到镜头后面。不过如果不想入镜，告诉我就好。'}[person.id];
    next.nodes.push({title:'一点点靠近',readingSeconds:45,lines:[{speaker:'旁白',text:action},{speaker:person.name,text:reply},{speaker:'许澄',text:'那今晚，就让我们慢慢来吧。反正雨还没有停。'},{speaker:person.name,text:'嗯。如果你愿意，下次也一起待到最后吧。'}],choices:[{text:'笑着答应下一次相见'},{text:'先一起喝完今晚的茶'}]});
  }else{
    const selected=cast.find(c=>c.id===next.route)||cast[0];
    next.nodes.push({title:'灯光留在这里',readingSeconds:45,lines:[{speaker:'许澄',text:index===0?'我愿意。下次记得叫我，我会早点来。':'好啊。不过今晚，先一起把茶喝完吧。'},{speaker:selected.name,text:index===0?'说好了。下次，也给你留一盏灯。':'好，不着急。今晚能这样坐在一起，就已经很好了。'},{speaker:'旁白',text:'窗外的雨渐渐小了。我们没有急着关灯，有些话，也终于可以留到下一次慢慢说。'}],choices:[]});
    next.complete=true;
  }
  return next;
}

export function isSaveSlot(value:unknown):value is SaveSlot {
  if(!value||typeof value!=='object')return false;
  const slot=value as SaveSlot;
  return slot.version===1&&['demo','live'].includes(slot.mode)&&Number.isInteger(slot.line)&&slot.line>=0&&!!slot.state&&Array.isArray(slot.state.nodes)&&slot.state.nodes.every(n=>Array.isArray(n.lines)&&n.lines.every(l=>typeof l.speaker==='string'&&typeof l.text==='string')&&Array.isArray(n.choices))&&!!slot.chats&&typeof slot.partner==='string'&&slot.partner.length>0;
}
