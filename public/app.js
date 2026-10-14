(() => {
  const $ = id => document.getElementById(id);
  const DIRS = [[1,0,'E'],[0,1,'S'],[-1,0,'W'],[0,-1,'N']];
  const state = { config:null, agent:null, timer:null, running:false, importedName:null };

  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const key = (x,y) => `${x},${y}`;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function randomFor(seed) { let x = (Number(seed)||1) >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }
  function cellIn(config,p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x>=0 && p.y>=0 && p.x<config.width && p.y<config.height; }
  function validateConfig(c) {
    if (!c || typeof c !== 'object' || !Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width<5 || c.height<5 || c.width>30 || c.height>22) throw new Error('Map size must be between 5×5 and 30×22.');
    if (!cellIn(c,c.start) || !cellIn(c,c.eve) || !Array.isArray(c.clues) || !Array.isArray(c.blocked)) throw new Error('Config needs a valid start, EVE location, clues array, and blocked array.');
    if (c.clues.length<1) throw new Error('Add at least one signal clue to the mission.');
    for (const clue of c.clues) if (!cellIn(c,clue)) throw new Error('Every clue needs an in-bounds x and y coordinate.');
    for (const pos of c.blocked) if (!Array.isArray(pos) || pos.length!==2 || pos[0]<0 || pos[1]<0 || pos[0]>=c.width || pos[1]>=c.height) throw new Error('A blocked tile falls outside the map.');
    if (c.blocked.some(([x,y])=>x===c.start.x&&y===c.start.y) || c.blocked.some(([x,y])=>x===c.eve.x&&y===c.eve.y)) throw new Error('The base and EVE must be on clear tiles.');
    c.resources = Object.assign({battery:100,timeLimit:160,moveCost:1,blockedCost:1,scanCost:2,rechargeAmount:50,maxRecharges:1,returnReserve:14},c.resources||{});
    c.signalNoise = clamp(Number(c.signalNoise)||0,0,.6);
    return c;
  }
  function setup(c,name=null,selection=null) {
    try { state.config=validateConfig(c); state.importedName=name; resetMission(); const select=$('missionSelect');select.querySelector('[data-custom]')?.remove();if(name){const option=document.createElement('option');option.value='__custom';option.textContent=`${c.name||name} · imported`;option.dataset.custom='true';select.append(option);select.value='__custom';}else select.value=selection||'garden.json'; $('connectionLabel').textContent='SIMULATION READY'; $('mapToast').textContent='Mission file loaded'; }
    catch(err) { alert(`Could not load mission file: ${err.message}`); }
  }
  async function loadPreset(file) {
    if (!file) return;
    try { const res=await fetch(`/missions/${encodeURIComponent(file)}`); if(!res.ok) throw new Error('Mission file could not be found.'); setup(await res.json(),null,file); }
    catch(err) { alert(`Could not load mission: ${err.message}`); }
  }
  function resetMission() {
    clearInterval(state.timer); state.running=false;
    const c=state.config; if (!c) return;
    const grid=Array.from({length:c.height},()=>Array.from({length:c.width},()=>({kind:'unknown',visits:0,clue:null,signal:false})));
    const a=state.agent={x:c.start.x,y:c.start.y,battery:c.resources.battery,maxBattery:c.resources.battery,elapsed:0,step:0,history:[],grid,path:[key(c.start.x,c.start.y)],knownClues:new Set(),foundClues:[],revealedEve:false,confidence:Number(c.initialSignal?.strength||.08),lastSignal:c.initialSignal?{direction:Number(c.initialSignal.direction),strength:Number(c.initialSignal.strength),age:0}:null,lastScanStep:-99,scanCount:0,returning:false,recharges:0,done:false,outcome:'',rng:randomFor(c.seed),returnReason:''};
    revealAt(a.x,a.y); const here=grid[a.y][a.x];here.visits++;
    renderAll(); setStatus('AT BASE','Ready for launch','ready'); $('startLabel').textContent='START MISSION'; $('connectionLabel').textContent='SIMULATION READY'; $('reportStamp').textContent='DRAFT'; $('reportStamp').className='report-stamp'; $('reportContent').innerHTML='<div class="report-placeholder"><span class="report-illustration">✳</span><h3>The story is still unfolding.</h3><p>When the mission ends, WALL-E will report what it found, where it thinks EVE is, and what to do next.</p></div>';
    $('downloadReport').disabled=true; $('traceList').innerHTML='<div class="empty-trace"><span>≋</span><b>No actions yet</b><p>Start the mission to watch WALL-E think out loud.</p></div>';
  }
  function revealAt(x,y) {
    const c=state.config,a=state.agent;
    for (const [dx,dy] of [[0,0],...DIRS.map(([x,y])=>[x,y])]) {
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=c.width||ny>=c.height)continue;
      const tile=a.grid[ny][nx];if(tile.kind!=='unknown')continue;
      const blocked=c.blocked.some(([bx,by])=>bx===nx&&by===ny);
      tile.kind=blocked?'wall':'floor';
    }
    a.grid[y][x].kind='floor';
  }
  function setStatus(label,detail,kind='ready') {
    $('agentState').textContent=label;$('agentSubstate').textContent=detail;
    $('agentDot').className=`state-dot ${kind}`;
  }
  function renderAll() { renderMap();renderMetrics();renderBelief(); }
  function renderMap() {
    const c=state.config,a=state.agent;if(!c||!a)return;
    const el=$('mapGrid');el.style.gridTemplateColumns=`repeat(${c.width},minmax(0,1fr))`;el.replaceChildren();
    const pathSet=new Set(a.path);
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const tile=a.grid[y][x],cell=document.createElement('div');cell.className=`map-cell ${tile.kind}`;
      if(pathSet.has(key(x,y)))cell.classList.add('path');
      if(x===state.config.start.x&&y===state.config.start.y)cell.classList.add('base');
      if(tile.clue)cell.classList.add('clue-found');
      if(a.revealedEve&&x===state.config.eve.x&&y===state.config.eve.y){cell.classList.remove('clue-found');cell.classList.add('eve-found');}
      if(tile.kind==='base'){const icon=document.createElement('span');icon.className='base-icon';icon.textContent='⌂';cell.append(icon);}
      if(tile.kind==='wall'&&tile.visits){const mark=document.createElement('span');mark.textContent='×';mark.className='wall-e';cell.append(mark);}
      if(tile.signal&&!tile.clue){const mark=document.createElement('span');mark.className='bearing-dot';cell.append(mark);}
      if(a.x===x&&a.y===y){cell.classList.add('bot-here');cell.replaceChildren();const bot=document.createElement('span');bot.className='wall-e';bot.textContent='W';cell.append(bot);}
      cell.title=tile.kind==='unknown'?'Unknown terrain':tile.clue?tile.clue:tile.kind==='wall'?'Blocked terrain':`X ${String(x).padStart(2,'0')} · Y ${String(y).padStart(2,'0')}`;
      el.append(cell);
    }
    $('coordinateReadout').textContent=`X ${String(a.x).padStart(2,'0')} · Y ${String(a.y).padStart(2,'0')}`;
    const known=a.grid.flat().filter(t=>t.kind!=='unknown').length;$('exploredValue').textContent=`${Math.round(known/(c.width*c.height)*100)}%`;
    $('mapDimensions').textContent=`${c.width} × ${c.height} GRID`;$('mapToast').textContent=a.done?a.outcome:a.returning?'RETURN ROUTE ACTIVE':`${a.path.length} safe steps mapped`;
  }
  function renderMetrics() {
    const a=state.agent,c=state.config;if(!a||!c)return;
    const pct=clamp(Math.round(a.battery/a.maxBattery*100),0,100);$('batteryValue').textContent=String(pct).padStart(2,'0');$('batteryMeter').style.width=`${pct}%`;$('batteryNote').textContent=pct<20?'RETURN RESERVE':pct<45?'POWER LOW':'CHARGE STABLE';
    $('batteryMeter').style.background=pct<20?'#e47d57':pct<45?'#dfb65f':'#a9c56c';
    $('confidenceValue').textContent=String(Math.round(a.confidence*100)).padStart(2,'0');$('confidenceMeter').style.width=`${Math.round(a.confidence*100)}%`;
    $('timeValue').textContent=`${String(Math.floor(a.elapsed/60)).padStart(2,'0')}:${String(a.elapsed%60).padStart(2,'0')}`;$('timeMeter').style.width=`${clamp(a.elapsed/c.resources.timeLimit*100,0,100)}%`;$('actionCount').textContent=`${a.step} ACTION${a.step===1?'':'S'}`;
    $('clueCount').textContent=`${a.foundClues.length} of ${c.clues.length} discovered`;
  }
  function renderBelief() {
    const a=state.agent;if(!a)return;
    const ping=$('radarPing'),dir=$('radarDirection');
    if(a.lastSignal){const sig=a.lastSignal;ping.classList.remove('hidden');const radius=clamp(47-sig.strength*35,12,44);ping.style.width=`${radius}px`;ping.style.height=`${radius}px`;dir.textContent='➤';dir.style.transform=`rotate(${sig.direction}deg) translateX(29px)`;
      $('lastReading').textContent=`${Math.round(sig.direction)}° · ${sig.strength.toFixed(2)} strength`;$('lastReadingDetail').textContent=`${sig.age===0?'Just now':`${sig.age} actions ago`} · bearing only, no coordinates`;$('signalNote').textContent=sig.strength>.62?'STRONG RETURN':sig.strength>.35?'BEARING LOCKED':'FAINT BEARING';
    }else{ping.classList.add('hidden');dir.textContent='—';$('lastReading').textContent='NO SIGNAL';$('lastReadingDetail').textContent='Run a scan to listen for EVE.';$('signalNote').textContent='AWAITING A SCAN';}
    $('eveStatus').textContent=a.revealedEve?'Visual contact confirmed':a.foundClues.length===state.config.clues.length?'All fragments found':'No visual contact';
    $('eveEstimate').textContent=a.revealedEve?`X${String(state.config.eve.x).padStart(2,'0')} Y${String(state.config.eve.y).padStart(2,'0')}`:a.confidence>.65?'Likely nearby':'Unconfirmed';
    $('clueEstimate').textContent=a.foundClues.length?`${a.foundClues.length} verified`:'Unknown';$('routeEstimate').textContent=a.returning?'Returning':a.done?'Complete':'Ready';$('routeStatus').textContent=a.returning?'Known path to base':'Base coordinates saved';
  }
  function appendTrace(action,observation,reason) {
    const a=state.agent;a.step++;
    const entry={step:a.step,action,observation,reason,battery:Math.round(a.battery),x:a.x,y:a.y,elapsed:a.elapsed};a.history.push(entry);
    const list=$('traceList');if(list.querySelector('.empty-trace'))list.innerHTML='';
    const row=document.createElement('div');row.className=`trace-entry ${action}`;
    row.innerHTML=`<span class="trace-step">${String(entry.step).padStart(2,'0')}</span><span class="trace-action">${escapeHtml(action)}</span><div class="trace-text"><b>${escapeHtml(observation)}</b><p>${escapeHtml(reason)} · ${entry.battery}% power</p></div>`;
    list.append(row);list.scrollTop=list.scrollHeight;
  }
  function neighbors(x,y){return DIRS.map(([dx,dy,d])=>({x:x+dx,y:y+dy,d})).filter(p=>p.x>=0&&p.y>=0&&p.x<state.config.width&&p.y<state.config.height);}
  function pathTo(startX,startY,goalX,goalY) {
    const a=state.agent,c=state.config,q=[{x:startX,y:startY,path:[]}],seen=new Set([key(startX,startY)]);
    while(q.length){const n=q.shift();if(n.x===goalX&&n.y===goalY)return n.path;
      for(const nb of neighbors(n.x,n.y)){const k=key(nb.x,nb.y);if(seen.has(k))continue;const t=a.grid[nb.y][nb.x];if(t.kind==='wall'||(t.kind==='unknown'&&!(nb.x===goalX&&nb.y===goalY)))continue;seen.add(k);q.push({x:nb.x,y:nb.y,path:[...n.path,{x:nb.x,y:nb.y}]});}
    }
    return null;
  }
  function frontierChoice() {
    const a=state.agent,c=state.config,q=[{x:a.x,y:a.y,path:[]}],seen=new Set([key(a.x,a.y)]),frontiers=[];
    while(q.length){const n=q.shift();for(const nb of neighbors(n.x,n.y)){const k=key(nb.x,nb.y),t=a.grid[nb.y][nb.x];
      if(t.kind==='unknown'){let dot=0;if(a.lastSignal){const rad=a.lastSignal.direction*Math.PI/180,vx=nb.x-a.x,vy=nb.y-a.y;dot=(vx*Math.cos(rad)+vy*Math.sin(rad))/(Math.hypot(vx,vy)||1);}const visits=t.visits||0;const score=n.path.length+1-(a.lastSignal?.strength||0)*dot*2.6+visits*2+a.rng()*.22;frontiers.push({x:nb.x,y:nb.y,path:n.path,score});continue;}
      if(t.kind==='wall'||seen.has(k))continue;seen.add(k);q.push({x:nb.x,y:nb.y,path:[...n.path,{x:nb.x,y:nb.y}]});
    }}
    frontiers.sort((u,v)=>u.score-v.score);return frontiers[0]||null;
  }
  function distance(p,q){return Math.hypot(p.x-q.x,p.y-q.y);}
  function signalTarget() {const a=state.agent,c=state.config;const remaining=c.clues.filter(x=>!a.knownClues.has(x.id));if(remaining.length)return remaining.sort((p,q)=>distance(a,p)-distance(a,q))[0];return c.eve;}
  function doScan() {
    const a=state.agent,c=state.config,target=signalTarget(),dx=target.x-a.x,dy=target.y-a.y,dist=Math.hypot(dx,dy);
    const noise=(a.rng()-.5)*c.signalNoise*72;const bearing=(Math.atan2(dy,dx)*180/Math.PI+noise+360)%360;
    const strength=clamp(1/(1+dist/3)+(a.rng()-.5)*c.signalNoise,.05,.99);
    a.lastSignal={direction:bearing,strength,age:0};a.lastScanStep=a.step+1;a.scanCount++;
    a.battery=Math.max(0,a.battery-c.resources.scanCost);a.elapsed+=2;
    for(const tile of a.grid.flat())tile.signal=false;
    const clue=c.clues.find(cl=>!a.knownClues.has(cl.id)&&distance(a,cl)<=1.5);
    if(clue){a.knownClues.add(clue.id);a.foundClues.push(clue.label||clue.id);a.grid[clue.y][clue.x].clue=clue.label||clue.id;a.confidence=clamp(a.confidence+.13+strength*.07,.08,.92);appendTrace('scan',`${clue.label||clue.id} found · ${Math.round(bearing)}° · ${strength.toFixed(2)} strength`,'A close-range return matches a fragment. Record its location, then follow the updated bearing.');}
    else if(a.knownClues.size===c.clues.length&&distance(a,c.eve)<=1.5){a.revealedEve=true;a.confidence=.97;a.grid[c.eve.y][c.eve.x].clue='EVE';appendTrace('scan',`Visual contact · EVE signal at X${String(c.eve.x).padStart(2,'0')} Y${String(c.eve.y).padStart(2,'0')}`,'All fragments align and the short-range scan resolves EVE’s location. Preserve the finding and head home.');a.returning=true;a.returnReason='EVE located';}
    else {a.confidence=clamp(a.confidence*.48+strength*.32+(a.knownClues.size/c.clues.length)*.24,.05,.88);appendTrace('scan',`Signal ${Math.round(bearing)}° · strength ${strength.toFixed(2)}`,strength>.55?'The return is getting stronger. Update the bearing estimate and move toward a nearby frontier.':'A faint bearing is present; one scan reduces uncertainty before committing more charge.');
      const guessX=clamp(Math.round(a.x+Math.cos(bearing*Math.PI/180)*Math.max(1,(1-strength)*5)),0,c.width-1),guessY=clamp(Math.round(a.y+Math.sin(bearing*Math.PI/180)*Math.max(1,(1-strength)*5)),0,c.height-1);if(a.grid[guessY][guessX].kind==='unknown')a.grid[guessY][guessX].signal=true;
    }
    a.lastSignal.age=0;a.lastSignal.strength=strength;
  }
  function doMove(target) {
    const a=state.agent,c=state.config,tile=a.grid[target.y][target.x];const blocked=c.blocked.some(([x,y])=>x===target.x&&y===target.y);a.battery=Math.max(0,a.battery-(blocked?c.resources.blockedCost:c.resources.moveCost));a.elapsed++;
    if(blocked){tile.kind='wall';tile.visits++;appendTrace('avoid',`Obstacle echo · X${target.x} Y${target.y} is blocked`,'The terrain return contradicts the assumed clear route. Mark the tile unsafe and replan from known ground.');}
    else{a.x=target.x;a.y=target.y;tile.kind='floor';tile.visits++;a.path.push(key(a.x,a.y));revealAt(a.x,a.y);appendTrace('move',`Moved to X${String(a.x).padStart(2,'0')} Y${String(a.y).padStart(2,'0')} · nearby terrain mapped`,a.lastSignal&&a.lastSignal.strength>.28?'The strongest bearing favors this reachable frontier; move one safe tile toward it.':'Explore the closest reachable unknown tile while keeping a clear route back to base.');
      if(distance(a,c.eve)<=1.3&&a.knownClues.size===c.clues.length&&!a.revealedEve){a.confidence=.89;appendTrace('observe','A pale shape crosses the edge of WALL-E’s camera','The final clue and bearing overlap here. Pause and verify with a focused scan.');}
    }
    if(a.lastSignal)a.lastSignal.age++;
  }
  function finish(outcome,success) {
    const a=state.agent,c=state.config;a.done=true;a.outcome=outcome;state.running=false;clearInterval(state.timer);state.timer=null;
    setStatus(success?'MISSION COMPLETE':'MISSION ENDED',success?'EVE is safe. WALL-E made it home.':outcome,success?'success':'warning');$('startLabel').textContent='MISSION COMPLETE';$('connectionLabel').textContent=success?'MISSION COMPLETE':'MISSION ENDED';
    $('reportStamp').textContent=success?'SUCCESS':'DEBRIEF';$('reportStamp').className=`report-stamp ${success?'complete':'failed'}`;
    const inferred=a.revealedEve?`X${String(c.eve.x).padStart(2,'0')} · Y${String(c.eve.y).padStart(2,'0')}`:a.lastSignal?`Bearing ${Math.round(a.lastSignal.direction)}° from X${a.x} Y${a.y}`:'No reliable bearing';
    const confidence=Math.round(a.confidence*100);const evidence=[...a.foundClues,...(a.revealedEve?['Visual contact']:[])];
    const next=success?'Keep the route marker and bring EVE’s signal archive back to base.':a.battery<12?'Recharge the rover and resume from the last verified clue.':'Launch a fresh scout from base with a wider scan interval.';
    $('reportContent').innerHTML=`<div class="report-summary"><span>MISSION RESULT</span><b>${escapeHtml(outcome)}</b><span>EVIDENCE</span><b>${escapeHtml(evidence.length?evidence.join(' · '):'No fragments verified')}</b><span>INFERRED LOCATION</span><b>${escapeHtml(inferred)}</b><span>CONFIDENCE</span><b>${confidence}%</b><span>POWER LEFT</span><b>${Math.round(a.battery)}%</b></div><div class="report-next"><b>NEXT STEP</b> · ${escapeHtml(next)}</div>`;
    $('downloadReport').disabled=false;renderAll();
  }
  function tick() {
    const a=state.agent,c=state.config;if(!a||a.done)return;
    if(a.elapsed>=c.resources.timeLimit){finish(`Time budget reached · ${a.foundClues.length} clues recovered`,false);return;}
    const homePath=pathTo(a.x,a.y,c.start.x,c.start.y);const returnDistance=homePath?.length??Math.abs(a.x-c.start.x)+Math.abs(a.y-c.start.y);
    if(!a.returning&&a.battery<=returnDistance*c.resources.moveCost+c.resources.returnReserve+3){a.returning=true;a.returnReason='Battery reserve';setStatus('RETURNING','Charge reserve protects the route home','running');appendTrace('return','Battery reserve reached · replanning to base','Return now while the known route is still affordable.');}
    if(a.returning){
      if(a.x===c.start.x&&a.y===c.start.y){
        if(a.revealedEve){finish('EVE found and returned safely',true);return;}
        if(a.recharges<c.resources.maxRecharges&&a.battery<c.resources.battery-c.resources.rechargeAmount*.35){const gain=Math.min(c.resources.rechargeAmount,a.maxBattery-a.battery);a.battery+=gain;a.recharges++;a.returning=false;a.returnReason='';a.elapsed+=4;appendTrace('recharge',`Docked at base · +${Math.round(gain)}% battery`,'A safe charging point is available. Recharge once, then resume the search with the new evidence.');setStatus('RECHARGING','Battery topped up · mission resumes','running');renderAll();return;}
        finish(a.foundClues.length?'Returned with verified evidence':'Returned safely · EVE not located',false);return;
      }
      const route=homePath;
      if(!route||!route.length){finish(`Return route lost · ${Math.round(a.battery)}% battery remains`,false);return;}
      if(a.battery<c.resources.moveCost){finish('Battery depleted before base',false);return;}
      doMove(route[0]);renderAll();return;
    }
    if(a.battery<=0){finish('Battery depleted · WALL-E needs recovery',false);return;}
    setStatus(a.lastSignal&&a.lastSignal.strength>.6?'SIGNAL LOCKED':'EXPLORING',a.knownClues.size===c.clues.length?'Following the final bearing':'Mapping the unknown, one safe step at a time','running');
    const shouldScan=a.step===0||!a.lastSignal||a.step-a.lastScanStep>=5||a.lastSignal.strength>.67||a.grid[a.y][a.x].signal;
    if(shouldScan&&a.battery>=c.resources.scanCost+3){doScan();}
    else {
      const target=frontierChoice();
      if(!target){a.returning=true;a.returnReason='No new frontier';appendTrace('return','No reachable unknown terrain remains','The known area is exhausted. Return to base with the verified evidence.');renderAll();return;}
      let next;if(target.path.length)next=target.path[0];else next={x:target.x,y:target.y};
      doMove(next);
    }
    if(a.revealedEve&&!a.returning){a.returning=true;a.returnReason='EVE located';}
    renderAll();
  }
  function startRun() {
    if(!state.agent||state.agent.done){resetMission();}
    if(state.running){state.running=false;clearInterval(state.timer);state.timer=null;$('startLabel').textContent='RESUME MISSION';$('connectionLabel').textContent='SIMULATION PAUSED';setStatus('PAUSED','Decision loop paused','ready');return;}
    state.running=true;$('startLabel').textContent='PAUSE MISSION';$('connectionLabel').textContent='AGENT ACTIVE';state.timer=setInterval(tick,650);tick();
  }
  function makeReport() {
    const a=state.agent,c=state.config;
    return {mission:c.name,outcome:a.outcome||'Mission in progress',status:a.done?'complete':'in progress',evidence:[...a.foundClues,...(a.revealedEve?['Visual contact']:[])],inferredLocation:a.revealedEve?{x:c.eve.x,y:c.eve.y}:a.lastSignal?{bearingDegrees:Math.round(a.lastSignal.direction),from:{x:a.x,y:a.y},confidence:Number(a.confidence.toFixed(2))}:null,confidence:Number(a.confidence.toFixed(2)),batteryRemaining:Math.round(a.battery),elapsedActions:a.step,elapsedSeconds:a.elapsed,recharges:a.recharges,recommendedNextStep:$('reportContent').querySelector('.report-next')?.textContent.replace(/^NEXT STEP\s*·\s*/,'')||'Continue exploring and scan again.',trace:a.history};
  }
  function download(filename,content,type='application/json') {const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);}
  function exportTrace(){if(!state.agent?.history.length){alert('Start the mission to create an action trace.');return;}download('walle-action-trace.json',JSON.stringify({mission:state.config.name,trace:state.agent.history},null,2));}
  function downloadReport(){if(!state.agent)return;download('walle-mission-report.json',JSON.stringify(makeReport(),null,2));}

  $('missionSelect').addEventListener('change',e=>{if(e.target.value&&e.target.value!=='__custom')loadPreset(e.target.value);});
  $('configFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{setup(JSON.parse(await file.text()),file.name.replace(/\.json$/i,''));$('mapToast').textContent=`${file.name} loaded`; }catch(err){alert(`Config must be valid JSON: ${err.message}`);}e.target.value='';});
  $('startButton').addEventListener('click',startRun);
  $('stepButton').addEventListener('click',()=>{if(!state.agent)return;if(state.running){state.running=false;clearInterval(state.timer);state.timer=null;$('startLabel').textContent='RESUME MISSION';}tick();});
  $('resetButton').addEventListener('click',resetMission);
  $('exportTrace').addEventListener('click',exportTrace);
  $('downloadReport').addEventListener('click',downloadReport);
  $('centerMap').addEventListener('click',()=>renderMap());
  $('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
  $('closeHelp').addEventListener('click',()=>$('helpDialog').close());$('closeHelpBottom').addEventListener('click',()=>$('helpDialog').close());
  loadPreset('garden.json');
})();

