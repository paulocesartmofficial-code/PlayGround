import * as THREE from 'three';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('main-menu'), briefing: $('briefing'), hud: $('hud'), pause: $('pause-menu'), result: $('result-screen'),
  canvas: $('game-canvas'), fade: $('fade'), error: $('boot-error'),
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const choose = (a) => a[Math.floor(Math.random() * a.length)];
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (isTouch) $('input-label').textContent = 'TACTILE CONTROLS';

let renderer, scene, camera, clock;
let active = false, paused = false, gameOver = false, audioOn = true;
let player, gun, muzzleFlash, cameraBob = 0, weaponKick = 0, walkPhase = 0;
let yaw = 0, pitch = 0, moveX = 0, moveZ = 0, isSprinting = false, isCrouching = false, jumping = false;
let health = 100, armor = 50, ammo = 30, reserve = 120, score = 0, kills = 0, shots = 0, hits = 0;
let wave = 0, waveKills = 0, waveTotal = 0, startTime = 0, elapsed = 0, lastShot = 0, reloadStart = 0, reloadDuration = 1.65;
let enemies = [], bullets = [], effects = [], pickups = [], colliders = [], decor = [], audioCtx = null;
let hitTimer = 0, hurtTimer = 0, comboCount = 0, comboTime = 0, lastKillTime = 0, waveBannerTimer = 0;
let joystickPointer = null, lookPointer = null, fireHeld = false, lastLookX = 0, lastLookY = 0;
let playerVelocity = new THREE.Vector3(), moveVelocity = new THREE.Vector3(), tmpVec = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const worldSize = 44;

function boot() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101719);
    scene.fog = new THREE.FogExp2(0x111a1b, 0.018);
    camera = new THREE.PerspectiveCamera(73, innerWidth / innerHeight, 0.08, 115);
    camera.rotation.order = 'YXZ';
    clock = new THREE.Clock();
    player = new THREE.Group();
    player.position.set(0, 1.68, 11);
    scene.add(player);
    player.add(camera);
    buildWorld();
    buildWeapon();
    setupEvents();
    updateMinimap();
    window.addEventListener('resize', onResize);
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    ui.error.textContent = `Unable to initialize the tactical renderer.\n\n${e.message}\n\nTry a browser with WebGL enabled.`;
    ui.error.classList.remove('hidden');
  }
}

const mats = {};
function mat(color, roughness = .8, metalness = .1, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function box(parent, name, size, pos, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...pos);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}
function cylinder(parent, name, radiusTop, radiusBottom, height, pos, material, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.name = name;
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function addCollider(x, z, w, d, h = 2) { colliders.push({ x, z, w, d, h }); }

function buildWorld() {
  mats.floor = mat(0x303638, .91, .16);
  mats.wall = mat(0x343b3c, .9, .18);
  mats.dark = mat(0x141a1b, .65, .35);
  mats.steel = mat(0x4b5352, .48, .55);
  mats.crate = mat(0x4a4b3b, .91, .12);
  mats.crate2 = mat(0x343e3b, .9, .16);
  mats.orange = mat(0xb8672e, .62, .2);
  mats.yellow = mat(0xe4a847, .6, .16, { emissive: 0x4f2607 });
  mats.cyan = mat(0x8bc4b2, .35, .15, { emissive: 0x1b6354, emissiveIntensity: 1.4 });
  mats.red = mat(0x9c3830, .45, .2, { emissive: 0x50100c, emissiveIntensity: 1.2 });
  mats.black = mat(0x090c0d, .7, .3);
  mats.concrete = mat(0x555a56, .96, .03);
  mats.rubble = mat(0x292f30, 1, 0);

  scene.add(new THREE.HemisphereLight(0xbed0c8, 0x141819, 1.35));
  const moon = new THREE.DirectionalLight(0xc9d7d0, 2.0);
  moon.position.set(-12, 24, 10); moon.castShadow = true;
  moon.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  moon.shadow.camera.left = -34; moon.shadow.camera.right = 34; moon.shadow.camera.top = 28; moon.shadow.camera.bottom = -28;
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.025; scene.add(moon);
  const fill = new THREE.DirectionalLight(0x82999b, .7); fill.position.set(20, 10, -20); scene.add(fill);
  const skyGlow = new THREE.PointLight(0x315e5c, 28, 38, 1.8); skyGlow.position.set(-1, 9, -17); scene.add(skyGlow);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mats.floor);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.12; ground.receiveShadow = true; scene.add(ground);
  // Subtle concrete seams and hazard markings anchor scale and orientation.
  const seamMat = mat(0x242b2c, 1, 0);
  for (let x = -40; x <= 40; x += 5) box(scene, 'floor seam', [.035, .012, 80], [x, -.1, 0], seamMat, false);
  for (let z = -40; z <= 40; z += 5) box(scene, 'floor seam', [80, .012, .035], [0, -.099, z], seamMat, false);

  // Distant perimeter and broken industrial walls.
  box(scene, 'north perimeter', [84, 9, 1], [0, 4.4, -39], mats.wall);
  box(scene, 'west perimeter', [1, 9, 80], [-42, 4.4, 0], mats.wall);
  box(scene, 'east perimeter', [1, 9, 80], [42, 4.4, 0], mats.wall);
  box(scene, 'south left wall', [22, 8, 1], [-31, 4, 38], mats.wall);
  box(scene, 'south right wall', [22, 8, 1], [31, 4, 38], mats.wall);
  for (const x of [-36, -22, 22, 36]) {
    box(scene, 'wall reinforcement', [.24, 8.8, 1.25], [x, 4.3, -38.35], mats.steel);
    box(scene, 'wall light', [.13, .12, .5], [x, 6.7, -37.7], mats.cyan, false);
  }
  box(scene, 'north ledge', [83, .3, 1.6], [0, 8.6, -38.1], mats.dark);
  // Relay building, visible beyond the active arena.
  box(scene, 'relay base', [13, 5, 8], [0, 2.5, -31], mats.dark);
  box(scene, 'relay face', [12.4, 4.3, .18], [0, 2.65, -26.9], mats.steel);
  box(scene, 'relay tower', [3.3, 11, 3.3], [0, 10, -31], mats.wall);
  box(scene, 'tower crown', [5.4, .45, 5.4], [0, 15.5, -31], mats.dark);
  cylinder(scene, 'antenna mast', .1, .14, 8, [0, 19.6, -31], mats.steel, 8);
  for (let y = 16.3; y < 22.8; y += 1.3) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 6), mats.red);
    beacon.position.set(0, y, -31); scene.add(beacon);
  }
  for (let i = 0; i < 5; i++) {
    const x = -4.4 + i * 2.2;
    box(scene, 'relay vent', [1.15, 2.8, .14], [x, 2.3, -26.76], mats.dark);
    box(scene, 'vent glow', [.05, 2.2, .04], [x, 2.3, -26.65], mats.cyan, false);
  }
  box(scene, 'relay sign', [7.6, 1.1, .2], [0, 5.2, -26.78], mats.black);
  box(scene, 'sign text bar', [4.1, .045, .03], [0, 5.35, -26.65], mats.cyan, false);

  // Warehouse wings frame the combat lane.
  buildWarehouse(-29, -23, false);
  buildWarehouse(29, -23, true);

  // Cover: varied crates, barriers, cable spools and drums.
  const crates = [
    [-15,-22,3.8,2.4,2.2], [-10,-28,3,2.8,2.5], [14,-25,4,2.2,2.4], [19,-18,3.1,2.5,2.2],
    [-20,-10,3.5,2.3,2], [-11,-13,4.2,2.3,2.5], [10,-12,4,2.5,2.4], [19,-7,3.2,2.3,2],
    [-16,0,3.8,2.2,1.8], [-7,-2,3.2,2.1,2.1], [8,0,4.2,2.4,2.2], [18,4,3.4,2.2,2.2],
    [-20,12,4,2.2,2.1], [-11,17,3.2,2,1.8], [10,14,4,2.2,2], [19,18,3.2,2.2,2.1],
    [-5,-20,2.1,2.1,2.5], [5,-19,2.4,2.1,2.7], [-2,9,2.2,2.2,2.4], [3,20,2.3,2,2.2],
  ];
  crates.forEach(([x,z,w,d,h], i) => buildCrate(x,z,w,d,h,i % 3 === 0 ? mats.crate2 : mats.crate));
  for (const [x,z] of [[-25,-14], [24,-28], [-24,5], [26,10], [-4,-33], [5,28]]) buildBarrier(x,z,rand(3.2,4.8));
  for (const [x,z] of [[-25,-6], [25,-3], [-25,23], [25,25], [-17,-31], [17,-31]]) buildDrum(x,z);

  // Scattered broken masonry and metal debris.
  for (let i = 0; i < 46; i++) {
    const x = rand(-37, 37), z = rand(-35, 33);
    if (Math.abs(x) < 22 && Math.abs(z) < 8) continue;
    const size = rand(.18, .75);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), i % 2 ? mats.rubble : mats.concrete);
    rock.position.set(x, size * .42, z); rock.rotation.set(rand(0, 2), rand(0, 6), rand(0, 2)); rock.castShadow = true; rock.receiveShadow = true; scene.add(rock);
  }

  // Scattered industrial lamps and emissive safety strips.
  for (const [x,z] of [[-26,-11],[26,-11],[-26,19],[26,19],[0,-36]]) {
    cylinder(scene, 'lamp post', .11, .16, 5.6, [x, 2.8, z], mats.dark, 8);
    box(scene, 'lamp arm', [1.2,.12,.12], [x + (x < 0 ? .45 : -.45),5.45,z], mats.steel);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.8,.12,.5), mats.yellow);
    lamp.position.set(x + (x < 0 ? .82 : -.82),5.35,z); scene.add(lamp);
    const pl = new THREE.PointLight(0xffa750, 8, 11, 2); pl.position.set(lamp.position.x, 5, z); scene.add(pl);
  }
  // Broken power lines and industrial pipework.
  for (const side of [-1, 1]) {
    for (let z = -34; z <= 31; z += 9) {
      box(scene, 'pipe', [.32,.32,7.8], [side * 39, 2.6, z], mats.dark);
      cylinder(scene, 'pipe collar', .29, .29, .22, [side * 39, 2.6, z - 3.4], mats.steel, 10).rotation.x = Math.PI / 2;
    }
  }
  buildConsole(-2.2, -25.8);
  buildConsole(2.2, -25.8);
  addCollider(-29, -23, 12, 11, 8); addCollider(29, -23, 12, 11, 8);
  addCollider(0, -31, 13, 8, 5);
  for (const [x,z,w,d,h] of crates) addCollider(x,z,w,d,h);
  for (const [x,z] of [[-25,-14],[24,-28],[-24,5],[26,10],[-4,-33],[5,28]]) addCollider(x,z,4.2,.9,1.2);
}

function buildWarehouse(x, z, mirror) {
  const wall = mats.wall, dark = mats.dark;
  box(scene, 'warehouse body', [13, 7, 12], [x, 3.5, z], wall);
  box(scene, 'warehouse roof', [14, .45, 13], [x, 7.1, z], dark);
  const frontZ = z + 6.08;
  box(scene, 'warehouse opening shadow', [8, 4.9, .15], [x, 2.9, frontZ], mats.black);
  for (let dx of [-5.5, 5.5]) box(scene, 'warehouse upright', [.5, 6.8, .6], [x+dx,3.4,frontZ], mats.steel);
  box(scene, 'warehouse lintel', [11.5,.45,.6], [x,6.6,frontZ], mats.steel);
  for (let i=0;i<5;i++) {
    const xx = x - 3.2 + i*1.6;
    box(scene,'warehouse slat',[.09,4,.1],[xx,2.8,frontZ+.08],mats.dark);
  }
  box(scene, 'warehouse sign', [4,.55,.12], [x,5.75,frontZ+.11], mats.dark);
  box(scene, 'warehouse glow', [2.4,.035,.04], [x,5.75,frontZ+.19], mirror ? mats.red : mats.cyan, false);
  for (let i=0;i<7;i++) {
    const y=.7+i*.85;
    box(scene,'side rib',[.14,.12,11],[x + (mirror?-6.65:6.65),y,z],mats.steel);
  }
  const light = new THREE.PointLight(mirror?0xff6548:0x79c6b0, 10, 15, 1.7);
  light.position.set(x,4,z+3); scene.add(light);
  addCollider(x,z,14,13,8);
}
function buildCrate(x,z,w,d,h,material) {
  const group = new THREE.Group(); group.position.set(x,0,z); scene.add(group);
  box(group,'crate body',[w,h,d],[0,h/2,0],material);
  const trim = mats.dark;
  for (const side of [-1,1]) {
    box(group,'crate rail',[.12,h+.06,d+.08],[side*(w/2-.14),h/2,0],trim);
    box(group,'crate rail',[w+.08,h+.06,.12],[0,h/2,side*(d/2-.14)],trim);
  }
  for (let i=-1;i<=1;i++) {
    box(group,'crate brace',[.14,h*.86,.17],[i*w*.27,h/2,0],mats.steel).rotation.z = i === 0 ? 0 : (i > 0 ? -.38 : .38);
  }
  box(group,'crate label',[.8,.4,.035],[0,h*.72,d/2+.025],mats.black,false);
  box(group,'crate label mark',[.36,.035,.02],[0,h*.74,d/2+.05],mats.yellow,false);
}
function buildBarrier(x,z,w) {
  const group = new THREE.Group(); group.position.set(x,0,z); scene.add(group);
  box(group,'concrete barrier',[w,1.1,.8],[0,.55,0],mats.concrete);
  box(group,'barrier cap',[w+.1,.12,.94],[0,1.12,0],mats.steel);
  for(let i=-1;i<=1;i++) box(group,'hazard stripe',[.36,.22,.02],[i*w*.3,.86,.416],mats.yellow,false);
}
function buildDrum(x,z) {
  cylinder(scene,'fuel drum',.55,.55,1.35,[x,.68,z],mats.orange,14);
  cylinder(scene,'drum rim',.57,.57,.09,[x,1.25,z],mats.steel,14);
  cylinder(scene,'drum base rim',.57,.57,.08,[x,.12,z],mats.steel,14);
  for(let y=.4;y<1.1;y+=.32) cylinder(scene,'drum rib',.565,.565,.055,[x,y,z],mats.dark,14);
  box(scene,'drum label',[.3,.28,.025],[x,.73,z+.552],mats.yellow,false);
}
function buildConsole(x,z) {
  box(scene,'relay console',[1.1,1.35,.8],[x,.68,z],mats.dark);
  box(scene,'console screen',[.8,.62,.06],[x,.95,z+.43],mats.cyan,false);
  box(scene,'console keyboard',[.72,.05,.22],[x,.42,z+.48],mats.steel,false);
  for(let i=0;i<3;i++) box(scene,'console indicator',[.08,.06,.02],[x-.2+i*.2,1.47,z+.42],i===1?mats.red:mats.cyan,false);
}

const enemyMaterials = [mat(0x424948,.8,.25), mat(0x4b4037,.82,.22), mat(0x343d3d,.76,.32)];
const enemyAccent = mat(0xc14732,.45,.2,{emissive:0x270804,emissiveIntensity:.7});
function buildWeapon() {
  gun = new THREE.Group();
  gun.position.set(.32,-.28,-.48);
  camera.add(gun);
  const bodyMat = mat(0x202728,.45,.66), edgeMat = mat(0x515958,.35,.72), gripMat = mat(0x111515,.8,.1);
  box(gun,'rifle receiver',[.18,.16,.48],[0,0,0],bodyMat,false,false);
  box(gun,'rifle upper',[.13,.07,.45],[0,.105,-.015],edgeMat,false,false);
  box(gun,'rifle handguard',[.14,.11,.44],[0,.005,-.4],gripMat,false,false);
  box(gun,'rifle stock',[.13,.13,.28],[0,.005,.35],bodyMat,false,false);
  box(gun,'rifle grip',[.11,.22,.13],[0,-.17,.08],gripMat,false,false).rotation.x=-.19;
  box(gun,'rifle magazine',[.12,.24,.14],[0,-.17,-.12],bodyMat,false,false).rotation.x=-.1;
  cylinder(gun,'rifle barrel',.035,.035,.56,[0,.04,-.83],edgeMat,10).rotation.x=Math.PI/2;
  cylinder(gun,'muzzle',.055,.055,.12,[0,.04,-1.15],gripMat,10).rotation.x=Math.PI/2;
  box(gun,'sight',[.055,.08,.08],[0,.18,-.34],gripMat,false,false);
  box(gun,'sight rail',[.05,.025,.33],[0,.16,-.16],edgeMat,false,false);
  const flashMat=new THREE.MeshBasicMaterial({color:0xffd17b,transparent:true,opacity:.95});
  muzzleFlash=new THREE.Mesh(new THREE.ConeGeometry(.12,.38,8),flashMat);
  muzzleFlash.position.set(0,.04,-1.36); muzzleFlash.rotation.x=-Math.PI/2; muzzleFlash.visible=false; gun.add(muzzleFlash);
}
function requestPointerLock(){
  const request=ui.canvas.requestPointerLock?.();
  request?.catch(()=>{});
}
function setupEvents() {
  $('deploy-btn').addEventListener('click',showBriefing);
  $('brief-btn').addEventListener('click',showBriefing);
  $('brief-close').addEventListener('click',()=>showPanel(ui.menu));
  $('brief-deploy').addEventListener('click',startGame);
  $('pause-btn').addEventListener('click',pauseGame);
  $('resume-btn').addEventListener('click',resumeGame);
  $('restart-btn').addEventListener('click',startGame);
  $('abort-btn').addEventListener('click',()=>{paused=false;active=false;document.exitPointerLock?.();showPanel(ui.menu);});
  $('retry-btn').addEventListener('click',startGame);
  $('menu-btn').addEventListener('click',()=>{active=false;gameOver=false;showPanel(ui.menu);});
  $('menu-audio').addEventListener('click',toggleAudio);
  $('hud-audio').addEventListener('click',toggleAudio);
  $('reload-btn').addEventListener('pointerdown',(e)=>{e.preventDefault();reload();});
  $('jump-btn').addEventListener('pointerdown',(e)=>{e.preventDefault();if(active&&!paused)jumping=true;});
  $('crouch-btn').addEventListener('pointerdown',(e)=>{e.preventDefault();isCrouching=!isCrouching;$('crouch-btn').classList.toggle('selected',isCrouching);});
  $('fire-btn').addEventListener('pointerdown',(e)=>{e.preventDefault();fireHeld=true;shoot();});
  for(const event of ['pointerup','pointercancel','pointerleave']) $('fire-btn').addEventListener(event,()=>fireHeld=false);
  const joystick=$('joystick'), knob=$('js-knob');
  joystick.addEventListener('pointerdown',(e)=>{if(!active||paused)return;joystickPointer=e.pointerId;joystick.setPointerCapture(e.pointerId);updateStick(e);});
  joystick.addEventListener('pointermove',(e)=>{if(e.pointerId===joystickPointer)updateStick(e);});
  const releaseStick=(e)=>{if(e.pointerId===joystickPointer){joystickPointer=null;moveX=moveZ=0;knob.style.transform='translate(0,0)';}};
  joystick.addEventListener('pointerup',releaseStick);joystick.addEventListener('pointercancel',releaseStick);
  function updateStick(e){const r=joystick.getBoundingClientRect(), dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),max=r.width*.31,len=Math.hypot(dx,dy),scale=len>max?max/len:1;moveX=clamp(dx*scale/max,-1,1);moveZ=clamp(dy*scale/max,-1,1);knob.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;}
  const look=$('look-zone');
  look.addEventListener('pointerdown',(e)=>{if(!active||paused)return;lookPointer=e.pointerId;lastLookX=e.clientX;lastLookY=e.clientY;look.setPointerCapture(e.pointerId);});
  look.addEventListener('pointermove',(e)=>{if(e.pointerId!==lookPointer)return;const dx=e.clientX-lastLookX,dy=e.clientY-lastLookY;lastLookX=e.clientX;lastLookY=e.clientY;yaw-=dx*.006;pitch=clamp(pitch-dy*.005,-1.18,1.18);});
  const releaseLook=(e)=>{if(e.pointerId===lookPointer)lookPointer=null;};look.addEventListener('pointerup',releaseLook);look.addEventListener('pointercancel',releaseLook);
  ui.canvas.addEventListener('click',()=>{if(active&&!paused&&!isTouch&&document.pointerLockElement!==ui.canvas)requestPointerLock();});
  ui.canvas.addEventListener('mousedown',(e)=>{if(e.button===0&&active&&!paused){fireHeld=true;shoot();}});
  window.addEventListener('mouseup',(e)=>{if(e.button===0)fireHeld=false;});
  document.addEventListener('mousemove',(e)=>{if(document.pointerLockElement===ui.canvas&&active&&!paused){yaw-=e.movementX*.0022;pitch=clamp(pitch-e.movementY*.0022,-1.18,1.18);}});
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==ui.canvas&&active&&!paused&&!isTouch)pauseGame();});
  document.addEventListener('keydown',(e)=>{if(e.repeat)return;switch(e.code){case'KeyW':case'ArrowUp':moveZ=-1;break;case'KeyS':case'ArrowDown':moveZ=1;break;case'KeyA':case'ArrowLeft':moveX=-1;break;case'KeyD':case'ArrowRight':moveX=1;break;case'ShiftLeft':case'ShiftRight':isSprinting=true;break;case'KeyR':reload();break;case'KeyC':isCrouching=!isCrouching;break;case'Space':jumping=true;break;case'Escape':if(active&&!paused)pauseGame();else if(paused)resumeGame();break;}});
  document.addEventListener('keyup',(e)=>{switch(e.code){case'KeyW':case'ArrowUp':if(moveZ<0)moveZ=0;break;case'KeyS':case'ArrowDown':if(moveZ>0)moveZ=0;break;case'KeyA':case'ArrowLeft':if(moveX<0)moveX=0;break;case'KeyD':case'ArrowRight':if(moveX>0)moveX=0;break;case'ShiftLeft':case'ShiftRight':isSprinting=false;break;}});
  window.addEventListener('blur',()=>{if(active&&!paused)pauseGame();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&active&&!paused)pauseGame();});
}
function showPanel(panel){for(const p of [ui.menu,ui.briefing,ui.pause,ui.result]){p.classList.add('hidden');p.setAttribute('aria-hidden','true');}if(panel){panel.classList.remove('hidden');panel.setAttribute('aria-hidden','false');}ui.hud.classList.toggle('hidden',panel!==null);ui.hud.setAttribute('aria-hidden',panel?'true':'false');}
function showBriefing(){showPanel(ui.briefing);}
function ensureAudio(){if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)();}catch{audioOn=false;}}if(audioCtx?.state==='suspended')audioCtx.resume();}
function tone(freq,duration,type='square',volume=.035,endFreq=freq){if(!audioOn)return;ensureAudio();if(!audioCtx)return;const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,audioCtx.currentTime);osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),audioCtx.currentTime+duration);gain.gain.setValueAtTime(volume,audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);osc.connect(gain);gain.connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+duration);}
function toggleAudio(){audioOn=!audioOn;$('menu-audio').classList.toggle('muted',!audioOn);$('hud-audio').classList.toggle('muted',!audioOn);if(audioOn)tone(520,.08,'sine',.02,760);}
function startGame(){
  ensureAudio();clearCombat();active=true;paused=false;gameOver=false;health=100;armor=50;ammo=30;reserve=120;score=0;kills=0;shots=0;hits=0;wave=0;waveKills=0;waveTotal=0;elapsed=0;startTime=performance.now();yaw=0;pitch=0;player.position.set(0,1.68,11);playerVelocity.set(0,0,0);moveX=moveZ=0;isSprinting=false;isCrouching=false;updateHUD();
  showPanel(null);ui.fade.classList.remove('fade-out');requestAnimationFrame(()=>ui.fade.classList.add('fade-out'));
  if(!isTouch)requestPointerLock();beginWave();
}
function clearCombat(){for(const item of [...enemies,...bullets,...effects,...pickups])scene.remove(item.group||item);enemies=[];bullets=[];effects=[];pickups=[];reloadStart=0;}
function beginWave(){wave++;waveKills=0;waveTotal=wave===1?5:wave===2?7:9;waveBannerTimer=2.7;$('wb-kicker').textContent=wave===1?'HOSTILES INBOUND':'REINFORCEMENTS DETECTED';$('wb-title').textContent=`WAVE 0${wave}`;$('wb-sub').textContent=wave===3?'FINAL ASSAULT':'CLEAR THE COMPOUND';$('wave-banner').classList.add('show');for(let i=0;i<waveTotal;i++)spawnEnemy(i);tone(300,.32,'sawtooth',.035,620);updateHUD();}
function spawnEnemy(index){
  const angle=rand(-Math.PI*.78,-Math.PI*.22),radius=rand(17,29),x=clamp(Math.sin(angle)*radius,-34,34),z=clamp(-Math.cos(angle)*radius-3,-34,4);
  const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
  const material=enemyMaterials[Math.floor(Math.random()*enemyMaterials.length)],headMat=mat(0x282e2d,.72,.24);
  const torso=box(group,'hostile torso',[.72,.88,.4],[0,1.24,0],material);torso.userData.enemy=true;
  const vest=box(group,'hostile vest',[.77,.42,.43],[0,1.28,-.015],enemyAccent);vest.userData.enemy=true;
  const head=new THREE.Mesh(new THREE.SphereGeometry(.24,12,10),headMat);head.position.set(0,1.92,0);head.castShadow=true;head.userData.enemy=true;group.add(head);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.27,12,8,0,Math.PI*2,0,Math.PI/2),mats.dark);helmet.position.set(0,2.01,0);helmet.castShadow=true;helmet.userData.enemy=true;group.add(helmet);
  for(const side of [-1,1]){
    const leg=box(group,'hostile leg',[.22,.65,.25],[side*.2,.36,0],headMat);leg.userData.enemy=true;
    const arm=box(group,'hostile arm',[.18,.56,.2],[side*.49,1.22,-.07],material);arm.userData.enemy=true;arm.rotation.z=side*.16;
  }
  box(group,'hostile rifle',[.12,.13,.65],[.28,1.12,-.36],mats.black).rotation.x=.12;
  const hp=wave===1?70:wave===2?85:100;
  const e={group,hp,maxHp:hp,fireAt:performance.now()+rand(1100,2600),speed:rand(.8,1.2)+wave*.09,phase:rand(0,6),alive:true};enemies.push(e);group.userData.enemyRef=e;
}
function shoot(){if(!active||paused||gameOver||reloadStart)return;const now=performance.now();if(now-lastShot<105)return;if(ammo<=0){reload();return;}lastShot=now;ammo--;shots++;weaponKick=Math.min(weaponKick+.085,.24);muzzleFlash.visible=true;muzzleFlash.scale.setScalar(rand(.7,1.2));setTimeout(()=>{if(muzzleFlash)muzzleFlash.visible=false;},45);tone(118,.09,'sawtooth',.045,45);const spread=(isSprinting?.027:.009)+Math.abs(moveX+moveZ)*.002;const dir=new THREE.Vector3((Math.random()-.5)*spread,(Math.random()-.5)*spread, -1).applyEuler(camera.rotation).normalize();raycaster.set(camera.getWorldPosition(tmpVec),dir);raycaster.far=75;
  const targets=[];for(const e of enemies)if(e.alive)targets.push(e.group);const hitscan=raycaster.intersectObjects(targets,true);let hitEnemy=null;if(hitscan.length){for(let node=hitscan[0].object;node;node=node.parent){if(node.userData.enemyRef){hitEnemy=node.userData.enemyRef;break;}}if(hitEnemy)damageEnemy(hitEnemy,hitscan[0].point);}
  if(!hitEnemy){const end=raycaster.ray.origin.clone().addScaledVector(dir,Math.min(50,hitscan[0]?.distance||30));spawnTracer(end);}
  $('crosshair').classList.add('firing');setTimeout(()=>$('crosshair').classList.remove('firing'),50);if(ammo<=5)$('low-ammo').classList.add('show');updateHUD();
}
function damageEnemy(e,point){if(!e.alive)return;hits++;e.hp-=34;if(point){const spark=new THREE.Mesh(new THREE.SphereGeometry(.075,6,6),new THREE.MeshBasicMaterial({color:0xffbd70}));spark.position.copy(point);scene.add(spark);effects.push({object:spark,time:.16});}hitTimer=.15;$('crosshair').classList.add('hit');$('hit-flash').classList.add('show');setTimeout(()=>$('crosshair').classList.remove('hit'),100);setTimeout(()=>$('hit-flash').classList.remove('show'),100);tone(680,.055,'sine',.018,430);if(e.hp<=0)killEnemy(e);}
function killEnemy(e){if(!e.alive)return;e.alive=false;scene.remove(e.group);enemies=enemies.filter(x=>x!==e);kills++;waveKills++;comboCount=performance.now()-lastKillTime<3500?comboCount+1:1;lastKillTime=performance.now();comboTime=2.5;score+=100*comboCount+wave*25;addFeed(`HOSTILE ${String(kills).padStart(2,'0')} NEUTRALIZED`,comboCount>1?`COMBO ×${comboCount}`:'VXR-7');if(Math.random()<.24)spawnPickup(e.group.position.x,e.group.position.z);tone(180,.18,'triangle',.04,80);if(waveKills>=waveTotal){if(wave<3){setTimeout(()=>{if(active&&!paused&&!gameOver)beginWave();},1800);}else setTimeout(()=>finishGame(true),1200);}updateHUD();}
function spawnTracer(end){const start=new THREE.Vector3();camera.getWorldPosition(start);const geometry=new THREE.BufferGeometry().setFromPoints([start,end]);const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xffc270,transparent:true,opacity:.8}));scene.add(line);effects.push({object:line,time:.075});}
function spawnPickup(x,z){const group=new THREE.Group();group.position.set(x,.45,z);scene.add(group);const material=mat(0x83dbc1,.3,.2,{emissive:0x1b8e70,emissiveIntensity:1.6});const cube=new THREE.Mesh(new THREE.OctahedronGeometry(.27),material);cube.position.y=.35;group.add(cube);const ring=new THREE.Mesh(new THREE.TorusGeometry(.36,.025,6,20),new THREE.MeshBasicMaterial({color:0x9ffff0}));ring.rotation.x=Math.PI/2;group.add(ring);pickups.push({group,type:Math.random()<.5?'health':'ammo',phase:rand(0,6)});}
function reload(){if(!active||paused||reloadStart||ammo===30||reserve<=0)return;reloadStart=performance.now();$('low-ammo').classList.remove('show');tone(280,.07,'square',.025,220);}
function updateReload(now){if(!reloadStart)return;const p=(now-reloadStart)/(reloadDuration*1000);$('reload-ring').style.strokeDashoffset=String(125*(1-clamp(p,0,1)));if(p>=1){const amount=Math.min(30-ammo,reserve);ammo+=amount;reserve-=amount;reloadStart=0;$('reload-ring').style.strokeDashoffset='125';tone(440,.1,'square',.025,650);updateHUD();}}
function addFeed(title,sub){const feed=$('kill-feed'),row=document.createElement('div');row.className='feed-row';row.innerHTML=`<b>${title}</b><span>${sub}</span>`;feed.prepend(row);while(feed.children.length>4)feed.lastElementChild.remove();setTimeout(()=>row.remove(),3600);}
function pickupNearby(){for(let i=pickups.length-1;i>=0;i--){const p=pickups[i],dx=p.group.position.x-player.position.x,dz=p.group.position.z-player.position.z;if(Math.hypot(dx,dz)<1.5){if(p.type==='health'){health=Math.min(100,health+25);$('pickup-toast').querySelector('span').textContent='+25 HEALTH';}else{reserve=Math.min(180,reserve+45);$('pickup-toast').querySelector('span').textContent='+45 AMMO';}score+=50;scene.remove(p.group);pickups.splice(i,1);$('pickup-toast').classList.add('show');setTimeout(()=>$('pickup-toast').classList.remove('show'),1700);tone(520,.16,'sine',.03,820);updateHUD();}}}
function updatePlayer(dt,now){
  camera.rotation.set(pitch,yaw,0,'YXZ');const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  moveVelocity.set(0,0,0).addScaledVector(right,moveX).addScaledVector(forward,-moveZ);if(moveVelocity.lengthSq()>1)moveVelocity.normalize();
  const moving=moveVelocity.lengthSq()>.01,speed=isCrouching?2.1:isSprinting?7.3:4.7;
  const nextX=player.position.x+moveVelocity.x*speed*dt,nextZ=player.position.z+moveVelocity.z*speed*dt;
  if(!collides(nextX,player.position.z))player.position.x=clamp(nextX,-39,39);
  if(!collides(player.position.x,nextZ))player.position.z=clamp(nextZ,-36,35);
  if(jumping&&player.position.y<=1.681){playerVelocity.y=5.1;jumping=false;}playerVelocity.y-=15*dt;player.position.y+=playerVelocity.y*dt;if(player.position.y<1.68){player.position.y=1.68;playerVelocity.y=0;}
  walkPhase+=moving?dt*(isSprinting?13:9):0;camera.position.y=(isCrouching?-.35:0)+(moving?Math.sin(walkPhase)*.025:0);camera.position.x=moving?Math.cos(walkPhase*.5)*.012:0;
  weaponKick=Math.max(0,weaponKick-dt*.72);gun.position.z=-.48+weaponKick;gun.position.y=-.28+Math.abs(weaponKick)*.28+(moving?Math.sin(walkPhase)*.012:0);gun.rotation.x=weaponKick*.45;
  pickupNearby();if(now-lastMinimap>450){updateMinimap();lastMinimap=now;}
}
function collides(x,z){for(const c of colliders){if(Math.abs(x-c.x)<c.w/2+.38&&Math.abs(z-c.z)<c.d/2+.38)return true;}return false;}
function updateEnemies(dt,now){for(const e of enemies){if(!e.alive)continue;const dx=player.position.x-e.group.position.x,dz=player.position.z-e.group.position.z,dist=Math.hypot(dx,dz);e.group.rotation.y=Math.atan2(dx,dz);e.phase+=dt*5;
  if(dist>7){const nx=e.group.position.x+(dx/dist)*e.speed*dt,nz=e.group.position.z+(dz/dist)*e.speed*dt;if(!collides(nx,e.group.position.z))e.group.position.x=nx;if(!collides(e.group.position.x,nz))e.group.position.z=nz;}
  e.group.position.y=Math.sin(e.phase)*.018;
  if(now>e.fireAt&&dist<27){e.fireAt=now+rand(1000,1900)-wave*90;enemyAttack(e,dist);}
}}
function enemyAttack(e,dist){const origin=e.group.position.clone().add(new THREE.Vector3(0,1.35,0));const target=player.position.clone().add(new THREE.Vector3(0,.15,0));const dir=target.sub(origin).normalize();const accuracy=clamp(.78-dist*.018,.22,.68);if(Math.random()<accuracy){const damage=rand(5,9)+(wave-1)*1.3;const absorbed=Math.min(armor,damage*.58);armor-=absorbed;health=Math.max(0,health-(damage-absorbed));hurtTimer=.28;score=Math.max(0,score);tone(72,.12,'sawtooth',.018,45);$('hurt-direction').style.setProperty('--hurt-angle',`${THREE.MathUtils.radToDeg(Math.atan2(e.group.position.x-player.position.x,e.group.position.z-player.position.z))}deg`);$('hurt-direction').classList.add('show');setTimeout(()=>$('hurt-direction').classList.remove('show'),300);$('damage-flash').style.opacity='.78';setTimeout(()=>$('damage-flash').style.opacity='0',140);updateHUD();if(health<=0)finishGame(false);}else{const shotEnd=origin.clone().addScaledVector(dir,dist);spawnEnemyTracer(origin,shotEnd);}}
function spawnEnemyTracer(start,end){const geometry=new THREE.BufferGeometry().setFromPoints([start,end]);const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xff6146,transparent:true,opacity:.38}));scene.add(line);effects.push({object:line,time:.14});}
function updateHUD(){
  $('health-val').textContent=Math.ceil(health);$('armor-val').textContent=Math.ceil(armor);$('health-bar').style.width=`${health}%`;$('armor-bar').style.width=`${armor*2}%`;
  $('ammo-val').textContent=String(ammo).padStart(2,'0');$('reserve-val').textContent=String(reserve).padStart(3,'0');$('score').textContent=String(score).padStart(6,'0');
  $('wave-label').textContent=`WAVE ${Math.min(wave||1,3)} / 3`;$('enemies-left').textContent=`${enemies.length} HOSTILES REMAINING`;$('wave-bar').style.width=`${waveTotal?waveKills/waveTotal*100:0}%`;
  $('wave-pips').querySelectorAll('i').forEach((el,i)=>el.classList.toggle('active',i<wave));$('combo').textContent=`×${Math.max(1,comboCount)}`;$('combo').classList.toggle('show',comboCount>1&&comboTime>0);
  $('low-ammo').classList.toggle('show',ammo<=5&&ammo>0);
  const ticks=$('ammo-ticks');if(!ticks.dataset.ready){ticks.innerHTML=Array.from({length:30},(_,i)=>`<i class="${i<ammo?'loaded':''}"></i>`).join('');ticks.dataset.ready='1';}else ticks.querySelectorAll('i').forEach((el,i)=>el.classList.toggle('loaded',i<ammo));
}
function updateMinimap(){const canvas=$('minimap'),ctx=canvas.getContext('2d');if(!ctx)return;const w=canvas.width,h=canvas.height,scale=2.05;ctx.clearRect(0,0,w,h);ctx.save();ctx.translate(w/2,h/2);ctx.rotate(-yaw);ctx.fillStyle='rgba(10,17,18,.9)';ctx.fillRect(-w/2,-h/2,w,h);ctx.strokeStyle='rgba(133,176,160,.12)';ctx.lineWidth=1;for(let i=-70;i<=70;i+=20){ctx.beginPath();ctx.moveTo(i,-76);ctx.lineTo(i,76);ctx.stroke();ctx.beginPath();ctx.moveTo(-76,i);ctx.lineTo(76,i);ctx.stroke();}ctx.fillStyle='rgba(170,186,170,.28)';for(const c of colliders){ctx.fillRect((c.x-player.position.x)*scale-c.w*scale/2,(c.z-player.position.z)*scale-c.d*scale/2,c.w*scale,c.d*scale);}for(const e of enemies){const x=(e.group.position.x-player.position.x)*scale,z=(e.group.position.z-player.position.z)*scale;ctx.fillStyle='#ff6146';ctx.beginPath();ctx.arc(x,z,3.2,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#9ff2d7';ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-4,4);ctx.lineTo(0,2);ctx.lineTo(4,4);ctx.closePath();ctx.fill();ctx.restore();}
let lastMinimap=0;
function pauseGame(){if(!active||paused||gameOver)return;paused=true;document.exitPointerLock?.();$('pause-score').textContent=String(score).padStart(6,'0');$('pause-acc').textContent=`${shots?Math.round(hits/shots*100):0}%`;$('pause-wave').textContent=`${Math.max(wave,1)} / 3`;showPanel(ui.pause);}
function resumeGame(){if(!active||!paused)return;paused=false;showPanel(null);if(!isTouch)requestPointerLock();clock.getDelta();}
function finishGame(won){if(gameOver)return;gameOver=true;active=false;paused=false;document.exitPointerLock?.();const accuracy=shots?Math.round(hits/shots*100):0;const mm=Math.floor(elapsed/60),ss=Math.floor(elapsed%60);$('result-kicker').textContent=won?'OPERATION COMPLETE':'OPERATOR DOWN';$('result-title').innerHTML=won?'SITE <span>SECURED</span>':'MISSION <span>FAILED</span>';$('result-copy').textContent=won?'All hostile forces eliminated. The relay is back online. Good work, Operator.':'The assault team overwhelmed your position. Regroup and redeploy.';$('result-score').textContent=String(score).padStart(6,'0');$('result-acc').textContent=`${accuracy}%`;$('result-kills').textContent=String(kills).padStart(2,'0');$('result-time').textContent=`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;const rank=won?(accuracy>72&&kills>=18?'S':accuracy>48?'A':'B'):(kills>8?'C':'D');$('result-rank').textContent=rank;$('rank-stars').textContent=rank==='S'?'★★★★★':rank==='A'?'★★★★☆':rank==='B'?'★★★☆☆':rank==='C'?'★★☆☆☆':'★☆☆☆☆';showPanel(ui.result);tone(won?440:110,.55,'triangle',.05,won?880:45);}
function onResize(){if(!renderer||!camera)return;renderer.setSize(innerWidth,innerHeight,false);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,isTouch?1.5:2));camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
function loop(){requestAnimationFrame(loop);const dt=Math.min(clock.getDelta(),.05),now=performance.now();if(active&&!paused&&!gameOver){elapsed=(now-startTime)/1000;updatePlayer(dt,now);updateEnemies(dt,now);updateReload(now);if(fireHeld)shoot();if(comboTime>0){comboTime-=dt;if(comboTime<=0){comboCount=0;updateHUD();}}if(waveBannerTimer>0){waveBannerTimer-=dt;if(waveBannerTimer<=0)$('wave-banner').classList.remove('show');}$('hud-timer').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`;}
  for(let i=effects.length-1;i>=0;i--){const fx=effects[i];fx.time-=dt;if(fx.object.material?.transparent)fx.object.material.opacity=Math.max(0,fx.time/.15);if(fx.time<=0){scene.remove(fx.object);fx.object.geometry?.dispose();fx.object.material?.dispose();effects.splice(i,1);}}
  for(const p of pickups){p.phase+=dt*2;p.group.rotation.y+=dt*1.1;p.group.position.y=.45+Math.sin(p.phase)*.08;}
  if(renderer&&scene&&camera)renderer.render(scene,camera);
}
boot();
