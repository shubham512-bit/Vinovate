(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isController = params.has('controller') || location.pathname === '/controller';
  $('hostView').classList.toggle('hidden', isController);
  $('controllerView').classList.toggle('hidden', !isController);
  let ws, currentRoom = '', reconnectTimer, lastMessage = 0, latency = 0;
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const makeCode = () => Array.from({length: 6}, () => codeChars[Math.floor(Math.random()*codeChars.length)]).join('');
  let pageUrl = `${location.protocol}//${location.host}/?controller=1`;

  function connect(role, room) {
    clearTimeout(reconnectTimer);
    currentRoom = room;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); }
    catch { setTimeout(() => connect(role, room), 1500); return; }
    ws.onopen = () => ws.send(JSON.stringify({type:'join', role, room}));
    ws.onmessage = event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'peer') onPeer(msg);
      else if (msg.type === 'joined' && role === 'controller') {
        $('phoneRoom').textContent = msg.room; $('joinPanel').classList.add('hidden'); $('padPanel').classList.remove('hidden');
        setPhoneState(true, 'CONNECTED'); startSensors();
      } else if (msg.type === 'input' && role === 'host') { applyInput(msg); }
      else if (msg.type === 'ping') { send({type:'pong', at:msg.at}); }
      else if (msg.type === 'pong') { latency = Math.max(0, Date.now()-msg.at); updateLatency(); }
      else if (msg.type === 'error' && role === 'controller') { $('sensorNote').textContent = msg.message; }
    };
    ws.onclose = () => {
      if (role === 'controller') { setPhoneState(false, 'RECONNECTING'); stopSensors(); }
      else { setHostState(false); }
      if (currentRoom) reconnectTimer = setTimeout(() => connect(role, room), 1200);
    };
    ws.onerror = () => {};
  }
  function send(data) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
  function onPeer(msg) {
    if (isController) { if (msg.role === 'host') setPhoneState(msg.connected, msg.connected ? 'CONNECTED' : 'HOST DISCONNECTED'); }
    else if (msg.role === 'controller') setHostState(msg.connected);
  }
  function setHostState(connected) {
    $('statusLed').classList.toggle('connected', connected);
    $('connectionText').textContent = connected ? 'Phone connected · tilt to steer' : 'Waiting for a phone';
    $('topStatus').textContent = connected ? 'CONTROLLER CONNECTED' : 'READY TO PAIR';
    $('connectionText').parentElement.classList.toggle('connected', connected);
    $('gameOverlay').classList.toggle('dismissed', connected);
    game.active = connected;
  }
  function setPhoneState(connected, label) {
    $('phoneStatus').textContent = label;
    $('phoneLed').parentElement.classList.toggle('connected', connected);
  }

  if (!isController) {
    const room = makeCode(); $('roomCode').textContent = room;
    $('pairLink').textContent = pageUrl;
    fetch('/info').then(r=>r.json()).then(info=>{ pageUrl=`${location.protocol}//${info.host}:${info.port}/?controller=1`; $('pairLink').textContent=pageUrl; }).catch(()=>{});
    connect('host', room);
    $('copyCode').onclick = async () => { try { await navigator.clipboard.writeText(room); $('copyCode').textContent='✓'; setTimeout(()=>$('copyCode').textContent='▢',1200); } catch {} };
    setInterval(() => { if (ws?.readyState === WebSocket.OPEN) send({type:'ping', at:Date.now()}); }, 1500);
    $('soundToggle').onclick = () => { soundOn = !soundOn; $('soundToggle').style.color = soundOn ? 'var(--lime)' : ''; };
    window.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'a') game.targetX = Math.max(-1,game.targetX-.18); if (e.key === 'ArrowRight' || e.key === 'd') game.targetX = Math.min(1,game.targetX+.18); if (e.key === ' ' ) game.boost=1; });
    startGame();
  } else {
    $('joinForm').addEventListener('submit', async e => { e.preventDefault(); const room = $('roomInput').value.trim().toUpperCase(); if (room.length < 4) { $('roomInput').focus(); return; } if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { try { sensorPermission = await DeviceOrientationEvent.requestPermission(); } catch { sensorPermission = 'denied'; } } connect('controller', room); setPhoneState(false, 'CONNECTING…'); });
    $('roomInput').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
    $('recalibrate').onclick = () => calibrate(true);
    setupButtons();
  }

  // Controller sensors: calibrate at rest, then convert relative tilt into a bounded steering axis.
  let neutral = 0, orientationReady = false, lastGamma = 0, tilt = 0, lastShake = 0, sensorTimer, sensorPermission = null, manualBoost = false, shakeBoostUntil = 0;
  function calibrate(show) { neutral = lastGamma; tilt = 0; if (show) $('sensorNote').textContent = 'Neutral position set · tilt to steer'; setTimeout(()=>{ if ($('sensorNote')) $('sensorNote').textContent='Move your phone gently to steer'; },1800); }
  async function startSensors() {
    if (orientationReady) return;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { const permission = sensorPermission || await DeviceOrientationEvent.requestPermission(); if (permission !== 'granted') throw new Error(); } catch { $('sensorNote').textContent='Sensor access blocked · use the buttons below'; }
    }
    window.addEventListener('deviceorientation', onOrientation, true);
    window.addEventListener('devicemotion', onMotion, true);
    orientationReady = true;
    setTimeout(() => calibrate(false), 500);
    sensorTimer = setInterval(() => send({type:'input', tilt, boost:manualBoost || Date.now()<shakeBoostUntil ? 1 : 0, timestamp:Date.now()}), 33);
  }
  function stopSensors() { clearInterval(sensorTimer); orientationReady=false; window.removeEventListener('deviceorientation',onOrientation,true); window.removeEventListener('devicemotion',onMotion,true); }
  function onOrientation(e) {
    if (e.gamma == null) return;
    lastGamma = e.gamma;
    const delta = lastGamma-neutral;
    tilt = Math.max(-1, Math.min(1, delta / 28));
    $('tiltBall').style.transform = `translate(${tilt*52}px,${Math.max(-22,Math.min(22,(e.beta||0)*.22))}px)`;
  }
  function onMotion(e) {
    const a=e.accelerationIncludingGravity; if (!a) return;
    const magnitude=Math.hypot(a.x||0,a.y||0,a.z||0);
    if (magnitude > 24 && Date.now()-lastShake > 800) { lastShake=Date.now(); triggerBoost(850); }
  }
  function triggerBoost(ms=0) {
    shakeBoostUntil = Date.now()+ms;
    $('boostMeter').style.width='100%';
    setTimeout(()=>{ if(Date.now()>=shakeBoostUntil) $('boostMeter').style.width='0%'; },ms);
  }
  function setupButtons() {
    const hold = (id, action) => { const el=$(id); const down=e=>{e.preventDefault(); action(true);}; const up=e=>{e.preventDefault();action(false);}; el.addEventListener('pointerdown',down); el.addEventListener('pointerup',up); el.addEventListener('pointercancel',up); el.addEventListener('pointerleave',up); };
    hold('boostButton',v=>{ manualBoost=v; $('boostMeter').style.width=v?'100%':'0%'; });
    const tap=(id,button)=>$(id).addEventListener('pointerdown',e=>{e.preventDefault();send({type:'input',tilt,[button]:1,timestamp:Date.now()});});
    tap('brakeButton','brake'); tap('jumpButton','jump');
    // Touch/drag steering fallback for devices without orientation sensors.
    const zone=$('tiltZone'); let dragging=false;
    zone.addEventListener('pointerdown',e=>{dragging=true;zone.setPointerCapture(e.pointerId);drag(e);});
    zone.addEventListener('pointermove',e=>{if(dragging)drag(e);});
    zone.addEventListener('pointerup',()=>dragging=false); zone.addEventListener('pointercancel',()=>dragging=false);
    function drag(e){const r=zone.getBoundingClientRect(); tilt=Math.max(-1,Math.min(1,((e.clientX-r.left)/r.width-.5)*2));$('tiltBall').style.transform=`translate(${tilt*52}px,0)`;}
  }
  function updateLatency(){if($('latency'))$('latency').textContent=`${latency} ms`;if($('phoneLatency'))$('phoneLatency').textContent=`${latency} ms`;}

  let soundOn=false;
  const game={active:false,x:0,targetX:0,boost:0,speed:0,score:0,brake:0,jump:0,objects:[],tick:0};
  function applyInput(msg) { game.targetX=Math.max(-1,Math.min(1,msg.tilt||0)); game.boost=Math.max(game.boost,msg.boost||0); game.brake=Math.max(game.brake,msg.brake||0); game.jump=Math.max(game.jump,msg.jump||0); }
  function startGame(){const c=$('game'),ctx=c.getContext('2d');let w,h,dpr=1;
    function resize(){const r=c.getBoundingClientRect();dpr=Math.min(devicePixelRatio||1,2);w=r.width;h=r.height;c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}new ResizeObserver(resize).observe(c);resize();
    function frame(){requestAnimationFrame(frame);if(!w||!h)return;game.tick++;
      game.x+=(game.targetX-game.x)*.075; game.speed+=(game.active?1:0-game.speed)*.05;
      game.speed=Math.max(0,Math.min(1,game.active?(0.53+game.boost*.42-game.brake*.25):0.28));
      const speed=game.speed; game.score+=game.active?Math.round(speed*2):0; $('score').textContent=String(game.score).padStart(6,'0').slice(-6);$('speedReadout').textContent=`${Math.round(speed*210)} KM/H`;
      game.boost=Math.max(0,game.boost-.035);game.brake=0;game.jump=Math.max(0,game.jump-.08);
      const horizon=h*.37, carY=h*.79; const curve=Math.sin(game.tick*.008)*w*.08;
      const roadAt=(y)=>{const p=(y-horizon)/(h-horizon);return {center:w/2+curve*(p*p)+game.x*0, half:w*(.13+.33*p)};};
      ctx.fillStyle='#111a1d';ctx.fillRect(0,0,w,h);
      // Sky glow and distant silhouettes
      const sky=ctx.createLinearGradient(0,0,0,horizon);sky.addColorStop(0,'#111720');sky.addColorStop(1,'#293631');ctx.fillStyle=sky;ctx.fillRect(0,0,w,horizon+2);
      ctx.fillStyle='#28322f';for(let i=0;i<16;i++){const x=(i*97+game.tick*.13)%(w+60)-20;const sh=12+(i*17%38);ctx.fillRect(x,horizon-sh,18,sh);}
      const road=ctx.createLinearGradient(0,horizon,0,h);road.addColorStop(0,'#242a2b');road.addColorStop(1,'#313535');ctx.fillStyle=road;ctx.beginPath();let a=roadAt(horizon);ctx.moveTo(a.center-a.half,horizon);a=roadAt(h);ctx.lineTo(a.center-a.half,h);ctx.lineTo(a.center+a.half,h);a=roadAt(horizon);ctx.lineTo(a.center+a.half,horizon);ctx.closePath();ctx.fill();
      for(let i=0;i<12;i++){const p=((i/12+game.tick*speed*.005)%1),y=horizon+p*(h-horizon),r=roadAt(y);const stripe=(Math.floor(i+game.tick*speed*.13)%2)===0;ctx.fillStyle=stripe?'#d6fb52':'#5c6835';const thickness=1+p*6;ctx.fillRect(r.center-r.half-thickness*2,y,thickness,thickness*2);ctx.fillRect(r.center+r.half,y,thickness,thickness*2);}
      for(let lane=1;lane<3;lane++)for(let i=0;i<10;i++){const p=((i/10+game.tick*speed*.006)%1),y=horizon+p*(h-horizon);if(i%2===0){const r=roadAt(y),x=r.center-r.half+2*r.half*lane/3;ctx.fillStyle='#cad5b333';ctx.fillRect(x-1,y,2,1+p*5);}}
      if(game.active&&game.tick%70===0)game.objects.push({lane:Math.random()*1.5+.75,p:.02,color:Math.random()>.5?'#ff668d':'#73d9ff'});
      game.objects=game.objects.filter(o=>o.p<1.1);for(const o of game.objects){o.p+=.0028+speed*.004;const y=horizon+o.p*(h-horizon),r=roadAt(y),x=r.center-r.half+2*r.half*o.lane/3,size=5+o.p*24;ctx.fillStyle=o.color;ctx.shadowColor=o.color;ctx.shadowBlur=10*o.p;ctx.beginPath();ctx.roundRect(x-size/2,y-size,size,size,3);ctx.fill();ctx.shadowBlur=0;if(o.p>.88&&Math.abs(o.lane/1.5+-.5-game.x*.47)<.17){game.score=Math.max(0,game.score-2);o.p=1.2;}}
      const r=roadAt(carY);const cx=r.center+game.x*r.half*.66,cy=carY-game.jump*22,carW=30,carH=44;
      ctx.save();ctx.translate(cx,cy);ctx.rotate(game.targetX*-.08);ctx.shadowColor='#d6fb5288';ctx.shadowBlur=game.boost?24:9;ctx.fillStyle=game.boost?'#e9ff86':'#d6fb52';ctx.beginPath();ctx.moveTo(0,-carH/2);ctx.lineTo(carW/2,carH/2);ctx.lineTo(carW*.24,carH*.37);ctx.lineTo(-carW*.24,carH*.37);ctx.lineTo(-carW/2,carH/2);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#151c20';ctx.fillRect(-5,-2,10,10);ctx.fillStyle='#f4f2eb';ctx.fillRect(-carW/2-2,carH*.2,4,8);ctx.fillRect(carW/2-2,carH*.2,4,8);ctx.restore();
      if(!game.active){ctx.fillStyle='#d6fb5230';ctx.fillRect(0,h*.92,w,1);}
    } frame();
  }
})();

