import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef2f7);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
$('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 1.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(250, 350, 450);
keyLight.castShadow = true;
scene.add(keyLight);
scene.add(new THREE.GridHelper(700, 35, 0x94a3b8, 0xcbd5e1));

const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.3, metalness: 0.12, side: THREE.DoubleSide });
const hubMaterial = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.24, metalness: 0.25 });
const sectionMaterial = new THREE.LineBasicMaterial({ color: 0xf59e0b });
let rotorGroup = new THREE.Group();
let axisGroup = new THREE.Group();
let bladeGeometry = null;
let customAirfoil = null;
let currentView = 'rotor';
scene.add(rotorGroup, axisGroup);

const inputMap = {
  Blades:'inpBlades', Hub:'inpHub', Span:'inpSpan', Root:'inpRoot', Taper:'inpTaper',
  RootTwist:'inpRootTwist', TipTwist:'inpTipTwist', Pitch:'inpPitch', Sweep:'inpSweep', RPM:'inpRPM', Wind:'inpWind'
};

function values() {
  const v = {};
  for (const [key,id] of Object.entries(inputMap)) v[key] = Number($(id).value);
  return v;
}

function nacaPoints(code, count=100) {
  const m = Number(code[0]) / 100;
  const p = Number(code[1]) / 10;
  const t = Number(code.slice(2)) / 100;
  const upper=[], lower=[];
  for (let i=0;i<=count;i++) {
    const beta = i * Math.PI / count;
    const x = (1-Math.cos(beta))/2;
    const yt = 5*t*(0.2969*Math.sqrt(x)-0.1260*x-0.3516*x*x+0.2843*x*x*x-0.1015*x*x*x*x);
    let yc=0, slope=0;
    if (m>0 && p>0) {
      if (x<p) { yc = m/(p*p)*(2*p*x-x*x); slope=2*m/(p*p)*(p-x); }
      else { yc=m/((1-p)*(1-p))*((1-2*p)+2*p*x-x*x); slope=2*m/((1-p)*(1-p))*(p-x); }
    }
    const th=Math.atan(slope);
    upper.push(new THREE.Vector2(x-yt*Math.sin(th), yc+yt*Math.cos(th)));
    lower.push(new THREE.Vector2(x+yt*Math.sin(th), yc-yt*Math.cos(th)));
  }
  return [...upper.slice().reverse(), ...lower.slice(1)];
}

function getAirfoilPoints() {
  return customAirfoil || nacaPoints($('inpNACA').value);
}

function localGeometry(s, v) {
  const r=s;
  let chordFactor;
  if (s<0.18) chordFactor=0.55+0.45*(s/0.18);
  else chordFactor=1-(1-v.Taper)*((s-0.18)/0.82);
  return {
    chord:v.Root*chordFactor,
    twist:THREE.MathUtils.lerp(v.RootTwist,v.TipTwist,s)+v.Pitch,
    sweep:Math.tan(THREE.MathUtils.degToRad(v.Sweep))*v.Span*s
  };
}

function transformPoint(p, station, v) {
  const g=localGeometry(station,v);
  const x=(p.x-0.25)*g.chord;
  const y=p.y*g.chord;
  const a=-THREE.MathUtils.degToRad(g.twist);
  const xr=x*Math.cos(a)-y*Math.sin(a)-g.sweep;
  const yr=x*Math.sin(a)+y*Math.cos(a);
  return new THREE.Vector3(xr, v.Hub+station*v.Span, yr);
}

function buildBladeGeometry(v) {
  const profile=getAirfoilPoints();
  const stations=20, n=profile.length;
  const positions=[], indices=[];
  for(let j=0;j<stations;j++) {
    const s=j/(stations-1);
    for(const p of profile) {
      const q=transformPoint(p,s,v);
      positions.push(q.x,q.y,q.z);
    }
  }
  for(let j=0;j<stations-1;j++) {
    for(let i=0;i<n;i++) {
      const ni=(i+1)%n, a=j*n+i, b=j*n+ni, c=(j+1)*n+ni, d=(j+1)*n+i;
      indices.push(a,b,d,b,c,d);
    }
  }
  const rootCenter=positions.length/3;
  positions.push(0,v.Hub,0);
  const tipCenter=positions.length/3;
  positions.push(-localGeometry(1,v).sweep,v.Hub+v.Span,0);
  for(let i=0;i<n;i++) {
    const ni=(i+1)%n;
    indices.push(rootCenter,ni,i);
    const a=(stations-1)*n+i,b=(stations-1)*n+ni;
    indices.push(tipCenter,a,b);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function disposeGroup(group) {
  group.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material && o.material!==bladeMaterial && o.material!==hubMaterial && o.material!==sectionMaterial) o.material.dispose(); });
  group.clear();
}

function sectionLine(station,v,color) {
  const pts=getAirfoilPoints().map(p=>transformPoint(p,station,v));
  pts.push(pts[0].clone());
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color}));
}

function buildAxes(v) {
  disposeGroup(axisGroup);
  if(!$('chkAxis').checked) return;
  const R=v.Hub+v.Span;
  axisGroup.add(new THREE.AxesHelper(Math.max(80,R*0.55)));
  const windDir=new THREE.Vector3(0,0,-1);
  const arrow=new THREE.ArrowHelper(windDir,new THREE.Vector3(0,0,R*0.8),R*0.55,0x10b981,R*0.08,R*0.04);
  axisGroup.add(arrow);
}

function updateRotor() {
  const v=values();
  disposeGroup(rotorGroup);
  if(bladeGeometry) bladeGeometry.dispose();
  bladeGeometry=buildBladeGeometry(v);
  const bladeCount=currentView==='blade'?1:v.Blades;
  for(let i=0;i<bladeCount;i++) {
    const holder=new THREE.Group();
    const mesh=new THREE.Mesh(bladeGeometry,bladeMaterial);
    mesh.castShadow=true; mesh.receiveShadow=true;
    holder.add(mesh);
    if($('chkSections').checked) {
      holder.add(sectionLine(0.05,v,0xef4444),sectionLine(0.5,v,0xf59e0b),sectionLine(1,v,0x06b6d4));
      const axisPts=[];
      for(let k=0;k<=40;k++) {
        const s=k/40,g=localGeometry(s,v);
        const base=transformPoint(new THREE.Vector2(0.25,0),s,v);
        axisPts.push(base);
      }
      holder.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(axisPts),new THREE.LineBasicMaterial({color:0xfacc15})));
    }
    holder.rotation.z=(Math.PI*2*i)/v.Blades;
    rotorGroup.add(holder);
  }
  if(currentView==='rotor') {
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(v.Hub*1.05,v.Hub*1.05,Math.max(22,v.Root*0.8),48),hubMaterial);
    hub.rotation.x=Math.PI/2;
    rotorGroup.add(hub);
    const spinner=new THREE.Mesh(new THREE.SphereGeometry(v.Hub*1.06,48,24,0,Math.PI*2,0,Math.PI/2),hubMaterial);
    spinner.rotation.x=Math.PI/2; spinner.scale.z=1.55; spinner.position.z=v.Root*0.35;
    rotorGroup.add(spinner);
  }
  buildAxes(v);
  updateOutputs(v);
  drawAirfoil();
}

function updateOutputs(v) {
  const R=(v.Hub+v.Span)/1000, diameter=2*R, area=Math.PI*R*R;
  const omega=2*Math.PI*v.RPM/60, tip=omega*R, tsr=v.Wind>0?tip/v.Wind:0;
  const avgChord=v.Root*(1+v.Taper)/2/1000;
  const solidity=v.Blades*avgChord/(Math.PI*R);
  $('outDiameter').textContent=`${diameter.toFixed(3)} m`;
  $('outArea').textContent=`${area.toFixed(3)} m²`;
  $('outOmega').textContent=`${omega.toFixed(2)} rad/s`;
  $('outTipSpeed').textContent=`${tip.toFixed(2)} m/s`;
  $('outTSR').textContent=tsr.toFixed(2);
  $('outSolidity').textContent=`${(solidity*100).toFixed(1)}%`;
}

function drawAirfoil() {
  const canvas=$('airfoilCanvas'),ctx=canvas.getContext('2d'),pts=getAirfoilPoints();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const pad=42,w=canvas.width-2*pad,h=canvas.height-2*pad;
  ctx.strokeStyle='#cbd5e1';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad,canvas.height/2);ctx.lineTo(canvas.width-pad,canvas.height/2);ctx.stroke();
  const ys=pts.map(p=>p.y), ymin=Math.min(...ys), ymax=Math.max(...ys), scaleY=Math.min(w,h/Math.max(0.18,ymax-ymin));
  ctx.strokeStyle='#2563eb';ctx.fillStyle='rgba(37,99,235,.12)';ctx.lineWidth=4;ctx.beginPath();
  pts.forEach((p,i)=>{const x=pad+p.x*w,y=canvas.height/2-p.y*scaleY;(i?ctx.lineTo(x,y):ctx.moveTo(x,y));});ctx.closePath();ctx.fill();ctx.stroke();
  ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad+.25*w,35);ctx.lineTo(pad+.25*w,canvas.height-35);ctx.stroke();
  const code=$('inpNACA').value;
  $('airfoilInfo').innerHTML=customAirfoil?`<b>Profil tersuai</b><br>${pts.length} titik koordinat.`:`<b>NACA ${code}</b><br>Camber maks. ${code[0]}% chord · lokasi ${Number(code[1])*10}% chord · ketebalan ${code.slice(2)}% chord.`;
}

function parseDat(text) {
  const pts=[];
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.trim().replace(/,/g,' ');
    if(!line || /^[A-Za-z]/.test(line)) continue;
    const nums=line.split(/\s+/).map(Number);
    if(nums.length>=2 && Number.isFinite(nums[0])&&Number.isFinite(nums[1])) pts.push(new THREE.Vector2(nums[0],nums[1]));
  }
  if(pts.length<20) throw new Error('Fail memerlukan sekurang-kurangnya 20 titik koordinat.');
  const minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x));
  if(maxX-minX<=0) throw new Error('Julat koordinat x tidak sah.');
  return pts.map(p=>new THREE.Vector2((p.x-minX)/(maxX-minX),p.y/(maxX-minX)));
}

function exportSTL(target,name) {
  target.updateMatrixWorld(true);
  const data=new STLExporter().parse(target,{binary:true});
  const blob=new Blob([data],{type:'model/stl'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}

function setCamera(kind) {
  const v=values(),R=v.Hub+v.Span,dist=Math.max(350,R*2.5);
  if(kind==='front') camera.position.set(0,0,dist);
  if(kind==='side') camera.position.set(dist,0,0);
  if(kind==='iso') camera.position.set(dist*.72,dist*.55,dist*.72);
  controls.target.set(0,0,0);controls.update();
}

let timer;
function scheduleUpdate(){clearTimeout(timer);timer=setTimeout(updateRotor,35);}
for(const [key,id] of Object.entries(inputMap)) {
  $(id).addEventListener('input',e=>{
    const decimals=key==='Taper'?2:key==='Wind'?1:0;
    $(`val${key}`).textContent=Number(e.target.value).toFixed(decimals);
    scheduleUpdate();
  });
}
$('inpNACA').addEventListener('change',()=>{customAirfoil=null;$('inpFile').value='';$('fileStatus').textContent='Menggunakan profil NACA terbina dalam.';updateRotor();});
$('inpFile').addEventListener('change',e=>{
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();reader.onload=()=>{try{customAirfoil=parseDat(reader.result);$('fileStatus').textContent=`${file.name}: ${customAirfoil.length} titik diterima.`;updateRotor();}catch(err){customAirfoil=null;$('fileStatus').textContent=err.message;}};reader.readAsText(file);
});
$('chkSections').addEventListener('change',updateRotor);$('chkAxis').addEventListener('change',updateRotor);
$('btnRotor').addEventListener('click',()=>{currentView='rotor';$('btnRotor').classList.add('active');$('btnBlade').classList.remove('active');updateRotor();});
$('btnBlade').addEventListener('click',()=>{currentView='blade';$('btnBlade').classList.add('active');$('btnRotor').classList.remove('active');updateRotor();});
document.querySelectorAll('.camera-btn').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera)));
$('btnExportBlade').addEventListener('click',()=>{const holder=rotorGroup.children.find(o=>o.type==='Group');if(holder)exportSTL(holder,'Blade_Education_Model_mm.stl');});
$('btnExportRotor').addEventListener('click',()=>exportSTL(rotorGroup,'Rotor_Education_Model_mm.stl'));
$('btnReset').addEventListener('click',()=>{
  const d={Blades:3,Hub:20,Span:200,Root:45,Taper:.3,RootTwist:20,TipTwist:4,Pitch:0,Sweep:0,RPM:300,Wind:5};
  for(const [k,val] of Object.entries(d)){ $(inputMap[k]).value=val;$(`val${k}`).textContent=Number(val).toFixed(k==='Taper'?2:k==='Wind'?1:0); }
  $('inpNACA').value='4412';$('inpFile').value='';customAirfoil=null;currentView='rotor';$('btnRotor').classList.add('active');$('btnBlade').classList.remove('active');updateRotor();setCamera('iso');
});

window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));});
const clock=new THREE.Clock();
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),rpm=Number($('inpRPM').value);if(rpm>0&&currentView==='rotor'){const physical=$('chkPhysical').checked;const omega=2*Math.PI*rpm/60;rotorGroup.rotation.z-=omega*dt*(physical?1:.08);}controls.update();renderer.render(scene,camera);}
updateRotor();setCamera('iso');animate();
