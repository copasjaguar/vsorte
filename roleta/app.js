/******** CONFIG ********/
const REDIRECT_URL = "about:blank";                 // <--- troque aqui
const LOCK_KEY     = "roleta8_lock_v1";             // trava 1 giro
const SEGMENTS = [ // 8 itens (sentido horário a partir do topo)
  "5 MIL\nREAIS",
  "R$ 10,00",
  "10 MIL\nREAIS",
  "R$ 20,00",
  "CARRO\n0 KM",
  "15 MIL\nREAIS",
  "CUPOM\n100%",
  "R$ 100,00",
];
const SPIN_MIN_TURNS = 6, SPIN_MAX_TURNS = 8, SPIN_DURATION = 6200;

/******** ELEMENTOS ********/
const wheel   = document.getElementById("wheel");
const wlabels = document.getElementById("wlabels");
const btn     = document.getElementById("spinBtn");
const msg     = document.getElementById("msg");
const confettiCanvas = document.getElementById("confetti");
const ctx = confettiCanvas.getContext("2d");

/******** STATE & HELPERS ********/
const N = SEGMENTS.length, STEP = 360/N;
let spinning = false, currentAngle = 0, tickGate = 0;
const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

function setCanSpin(v){ document.body.classList.toggle("can-spin", !!v); }
function setIsSpinning(v){ document.body.classList.toggle("is-spinning", !!v); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function formatPrize(p){ return p.replace(/\n/g," "); }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

/******** LABELS (grudadas nos gomos) ********/
function mountLabels(){
  if(!wheel) return;
  wlabels.innerHTML = "";
  const radius = wheel.clientWidth * 0.33;
  for(let i=0;i<N;i++){
    const d = document.createElement("div");
    d.className = "wlabel";
    d.style.transform = `translate(-50%,-50%) rotate(${i*STEP}deg) translate(${radius}px)`;
    d.textContent = SEGMENTS[i];
    wlabels.appendChild(d);
  }
}
new ResizeObserver(mountLabels).observe(wheel);

/******** ÁUDIO (Web Audio) ********/
const ac = new (window.AudioContext||window.webkitAudioContext)();
let audioUnlocked = false;

// desbloqueia áudio na 1ª interação
function unlockAudio(){
  if(audioUnlocked) return;
  if(ac.state === "suspended") ac.resume();
  // mini-click inaudível só pra destravar em iOS/Android
  const o = ac.createOscillator(), g = ac.createGain();
  g.gain.value = 0.00001; o.connect(g).connect(ac.destination);
  o.start(); o.stop(ac.currentTime + 0.03);
  audioUnlocked = true;
}
window.addEventListener("pointerdown", unlockAudio, { once:true, passive:true });

// catraca (tick)
function tick(){
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "square"; o.frequency.setValueAtTime(1150, ac.currentTime);
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.28, ac.currentTime + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.05);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.06);
}

// vitória: jingle + aplausos/gritos sintetizados
function cheer(){
  // jingle
  const tones = [523,659,784,1047]; // C5,E5,G5,C6
  tones.forEach((f,i)=>{
    const o = ac.createOscillator(), g = ac.createGain();
    o.type="triangle"; o.frequency.value=f;
    const t0 = ac.currentTime + i*0.12;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+0.28);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0+0.3);
  });

  // crowd (ruído bandpass)
  const dur = 1.2;
  const noise = ac.createBufferSource();
  const buffer = ac.createBuffer(1, ac.sampleRate*dur, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*0.5;
  noise.buffer=buffer; noise.loop=false;

  const bp=ac.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1800; bp.Q.value=0.7;
  const g=ac.createGain();
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.7, ac.currentTime+0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+dur);
  noise.connect(bp).connect(g).connect(ac.destination); noise.start();

  // palmas
  for(let i=0;i<12;i++){
    const t = ac.currentTime + Math.random()*0.8;
    const clap = ac.createBufferSource();
    const b2 = ac.createBuffer(1, ac.sampleRate*0.18, ac.sampleRate);
    const d2 = b2.getChannelData(0);
    for(let j=0;j<d2.length;j++) d2[j] = (Math.random()*2-1)*(1-j/d2.length);
    clap.buffer=b2;
    const hp=ac.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=900;
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.9, t); g2.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
    clap.connect(hp).connect(g2).connect(ac.destination); clap.start(t);
  }

  // gritos "woo"
  for(let i=0;i<3;i++){
    const t = ac.currentTime + 0.1 + i*0.15;
    const o = ac.createOscillator(), g3=ac.createGain();
    o.type="sawtooth"; o.frequency.setValueAtTime(420+Math.random()*80, t);
    o.frequency.exponentialRampToValueAtTime(300, t+0.25);
    g3.gain.setValueAtTime(0.0001, t); g3.gain.exponentialRampToValueAtTime(0.25, t+0.02);
    g3.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
    o.connect(g3).connect(ac.destination); o.start(t); o.stop(t+0.26);
  }
}

/******** Giro ********/
function pickRandomSegment(){
  const url = new URL(location.href);
  const q = url.searchParams.get("prize");
  if(q!==null){ return clamp(parseInt(q,10)||0, 0, N-1); }
  return Math.floor(Math.random()*N);
}

function spin(){
  if(spinning) return;
  if(localStorage.getItem(LOCK_KEY)){ window.location.href = REDIRECT_URL; return; }

  spinning = true;
  btn.disabled = true;
  msg.textContent = "Girando...";
  setIsSpinning(true);
  setCanSpin(false);

  if(ac.state==="suspended") ac.resume();

  // vibra um tico no começo (se suportado)
  navigator.vibrate?.(prefersReduced ? 10 : 20);

  const idx = pickRandomSegment();
  const targetAngle = (360 - (idx*STEP + STEP/2)) % 360; // centro do gomo no topo
  const extraTurns = Math.floor(Math.random()*(SPIN_MAX_TURNS-SPIN_MIN_TURNS+1))+SPIN_MIN_TURNS;
  const total = extraTurns*360 + targetAngle;

  const start = performance.now();

  function frame(t){
    const k = Math.min(1, (t - start)/SPIN_DURATION);
    const eased = easeOutCubic(k);
    const angle = currentAngle + total*eased;
    wheel.style.transform = `rotate(${angle}deg)`;

    // tick por segmento
    const pos = (angle % 360 + 360) % 360;
    const gate = Math.floor(pos / STEP);
    if(gate !== tickGate && k<0.985){ tickGate = gate; tick(); }

    if(k<1){
      requestAnimationFrame(frame);
    }else{
      currentAngle = (currentAngle + total) % 360;
      onFinish(idx);
    }
  }
  requestAnimationFrame(frame);
}

function onFinish(idx){
  localStorage.setItem(LOCK_KEY, "1");
  setIsSpinning(false);

  const prize = formatPrize(SEGMENTS[idx]);
  msg.innerHTML = `🎉 <b>Resultado:</b> ${prize}`;

  // vibra curtinho ao parar
  navigator.vibrate?.(prefersReduced ? 15 : [20,40,20]);

  cheer();
  launchConfetti(1600);

  setTimeout(()=>{ window.location.href = REDIRECT_URL; }, 2300);
}

/******** Confete (canvas) ********/
let confettiRunning=false;
function launchConfetti(ms=1500){
  if(confettiRunning) return; confettiRunning=true;
  confettiCanvas.classList.remove("hidden");
  confettiCanvas.width = innerWidth; confettiCanvas.height = innerHeight;
  const particles=[], COLORS=["#ffd23b","#ff71d0","#66e3ff","#50f0a7","#fff"];
  const count=Math.min(240, Math.floor(innerWidth/6));
  for(let i=0;i<count;i++){
    particles.push({
      x:Math.random()*confettiCanvas.width,
      y:-20-Math.random()*innerHeight*.5,
      r:3+Math.random()*5,
      c:COLORS[(Math.random()*COLORS.length)|0],
      vx:-2+Math.random()*4,
      vy:2+Math.random()*3,
      rot:Math.random()*360,
      vr:-6+Math.random()*12
    });
  }
  const start=performance.now();
  (function loop(t){
    const k=(t-start)/ms;
    ctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
    particles.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.03; p.rot+=p.vr;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle=p.c; ctx.fillRect(-p.r,-p.r,p.r*2,p.r*2); ctx.restore();
    });
    if(k<1){ requestAnimationFrame(loop); }
    else{ confettiCanvas.classList.add("hidden"); confettiRunning=false; }
  })(start);
}

/******** Tilt/Parallax suave ********/
(function(){
  if(prefersReduced) return; // respeita redução de movimento
  const lerp = (a,b,t)=>a+(b-a)*t;
  let tx = 0, ty = 0; // alvo em graus
  function onMove(e){
    const p = ('touches' in e ? e.touches[0] : e);
    const x = p.clientX, y = p.clientY;
    const cx = window.innerWidth/2, cy = window.innerHeight/2;
    const dx = (x - cx) / cx;   // -1..1
    const dy = (y - cy) / cy;
    tx = dy * -6;
    ty = dx *  6;
  }
  window.addEventListener('mousemove', onMove, {passive:true});
  window.addEventListener('touchmove', onMove, {passive:true});
  function loop(){
    const root = document.documentElement;
    const curX = parseFloat(getComputedStyle(root).getPropertyValue('--tiltX')) || 0;
    const curY = parseFloat(getComputedStyle(root).getPropertyValue('--tiltY')) || 0;
    const nx = lerp(curX, tx, .08), ny = lerp(curY, ty, .08);
    root.style.setProperty('--tiltX', nx+'deg');
    root.style.setProperty('--tiltY', ny+'deg');
    requestAnimationFrame(loop);
  }
  loop();
})();

/******** INIT ********/
document.getElementById("spinBtn").addEventListener("click", spin);

// estado inicial do botão/animações
setCanSpin(!localStorage.getItem(LOCK_KEY));

// se já girou, oferece atalho
if(localStorage.getItem(LOCK_KEY)){
  btn.disabled = true;
  msg.innerHTML = `Você já usou seu giro. <a href="#" id="goNext">Ir para a próxima etapa</a>`;
  document.addEventListener("click", e=>{
    if(e.target && e.target.id==="goNext"){ e.preventDefault(); window.location.href = REDIRECT_URL; }
  });
}

// re-montar labels em resize e no load
window.addEventListener("load", mountLabels, {once:true});
