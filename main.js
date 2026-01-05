// TUNING SECTION — edit these values to change handling & visuals
const TUNING = {
  acceleration: 40.0,      // m/s^2 (engine force)
  maxSpeed: 55.0,          // m/s (~200 km/h is 55 m/s)
  braking: 60.0,           // deceleration when braking
  reverseSpeed: 12.0,      // max reverse speed (m/s)
  steeringMax: 2.0,        // radians/sec at high steering input
  steeringSpeedFactor: 0.02, // how much steering scales with speed
  grip: 5.0,               // lateral grip (higher = less slide)
  driftGrip: 1.2,          // grip multiplier when drifting (lower = easier drift)
  handbrakeGrip: 0.6,      // grip while handbrake is held
  drag: 0.5,               // air drag
  roadWidth: 8.0,          // meters (half-width from centerline used below)
  cameraDistance: 8.0,
  cameraHeight: 3.0,
  cameraLag: 0.12,
  cameraShakeAtSpeed: 30.0,
  pixelationFactor: 3 // 1 = native res, 2+ = more pixelated
}

// Basic app using ES module Three.js via CDN
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

// Globals
let scene, camera, renderer;
let track = { points: [], curve: null };
let car;
let keys = {};
let lastTime = performance.now();
let skidMarks = [];

// HUD elements
const hud = {
  speed: document.getElementById('speed'),
  drift: document.getElementById('drift'),
  lap: document.getElementById('lap'),
  time: document.getElementById('time')
};

// Lap timer state
let lapState = { laps:0, best: null, startTime: null, lastCross: null };

init();
animate();

function init(){
  // Renderer with pixelated low-res scaling
  renderer = new THREE.WebGLRenderer({antialias:false});
  document.body.appendChild(renderer.domElement);
  resize();
  window.addEventListener('resize', resize);

  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xfff4d6, 0.8);
  sun.position.set(5,10,2);
  scene.add(sun);

  // Sky gradient — huge sphere with simple shader-like color using vertex colors
  const skyGeo = new THREE.SphereGeometry(400, 12, 6);
  const skyMat = new THREE.MeshBasicMaterial({color:0x88ccff, side:THREE.BackSide});
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.y = -50;
  scene.add(sky);

  // Build track
  buildTrack();

  // Add surroundings
  addHillsAndTrees();

  // Car
  car = createCar();
  scene.add(car.group);
  car.position.set(track.points[0].x, 0, track.points[0].z);
  car.velocity.set(0,0,0);

  // Ground grid subtle plane
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000,2000,2,2), new THREE.MeshLambertMaterial({color:0x4ea04e}));
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.01;
  scene.add(ground);

  // Input
  window.addEventListener('keydown', e=>{ keys[e.key.toLowerCase()] = true; if(e.key===' ') e.preventDefault(); });
  window.addEventListener('keyup', e=>{ keys[e.key.toLowerCase()] = false; });

  // Start lap timer
  lapState.startTime = performance.now();
  lapState.lastCross = null;
}

function resize(){
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pf = Math.max(1, Math.floor(TUNING.pixelationFactor));
  renderer.setSize(Math.max(1,Math.floor(w/pf)), Math.max(1,Math.floor(h/pf)), false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

function buildTrack(){
  // Create a looping centerline using points around an oval with random perturbations
  const pts = [];
  const R = 80;
  for(let i=0;i<32;i++){
    const a = (i/32)*Math.PI*2;
    const r = R + Math.sin(i*0.7)*6 + (Math.random()*6-3);
    pts.push(new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r));
  }
  // Smooth curve
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  track.points = curve.getPoints(512);
  track.curve = curve;

  // Road mesh built from centerline
  const roadGeo = buildRoadGeometry(track.points, TUNING.roadWidth);
  const roadMat = new THREE.MeshLambertMaterial({color:0x333233});
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  scene.add(road);

  // Lines: center double yellow and edge whites
  addRoadLines(track.points);
  addGuardRails(track.points);
}

function buildRoadGeometry(points, halfWidth){
  const segments = points.length;
  const positions = [];
  const normals = [];
  const uvs = [];
  for(let i=0;i<segments;i++){
    const p = points[i];
    const next = points[(i+1)%segments];
    const forward = new THREE.Vector3().subVectors(next,p).normalize();
    const left = new THREE.Vector3(-forward.z,0,forward.x);
    const leftPos = new THREE.Vector3().addVectors(p, left.clone().multiplyScalar(halfWidth));
    const rightPos = new THREE.Vector3().addVectors(p, left.clone().multiplyScalar(-halfWidth));
    positions.push(leftPos.x,leftPos.y,leftPos.z);
    positions.push(rightPos.x,rightPos.y,rightPos.z);
    normals.push(0,1,0,0,1,0);
    const v = i/segments;
    uvs.push(0,v,1,v);
  }
  const index = [];
  for(let i=0;i<segments;i++){
    const a = i*2, b = i*2+1, c = ((i+1)%segments)*2, d = ((i+1)%segments)*2+1;
    index.push(a,c,d); index.push(a,d,b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(index);
  return geo;
}

function addRoadLines(points){
  // Center double yellow
  const centerPts = points.map(p=>new THREE.Vector3(p.x,p.y+0.01,p.z));
  const matY = new THREE.MeshBasicMaterial({color:0xffdd33});
  const matW = new THREE.MeshBasicMaterial({color:0xffffff});
  for(let offset of [-0.25,0.25]){
    const geo = buildStripAlong(points, 0.15, offset);
    const mesh = new THREE.Mesh(geo, matY);
    scene.add(mesh);
  }
  // Edge lines
  const leftEdge = buildStripAlong(points, 0.05, TUNING.roadWidth-0.15);
  const rightEdge = buildStripAlong(points, 0.05, -(TUNING.roadWidth-0.15));
  scene.add(new THREE.Mesh(leftEdge, matW));
  scene.add(new THREE.Mesh(rightEdge, matW));
}

function buildStripAlong(points, width, lateralOffset){
  // Build a thin rectangular strip placed along centerline at lateralOffset
  const positions=[]; const normals=[]; const uvs=[]; const idx=[];
  const seg = points.length;
  for(let i=0;i<seg;i++){
    const p = points[i];
    const next = points[(i+1)%seg];
    const forward = new THREE.Vector3().subVectors(next,p).normalize();
    const left = new THREE.Vector3(-forward.z,0,forward.x);
    const center = new THREE.Vector3().addVectors(p, left.clone().multiplyScalar(lateralOffset));
    const a = new THREE.Vector3().addVectors(center, left.clone().multiplyScalar(width));
    const b = new THREE.Vector3().addVectors(center, left.clone().multiplyScalar(-width));
    positions.push(a.x,a.y+0.02,a.z,b.x,b.y+0.02,b.z);
    normals.push(0,1,0,0,1,0);
    uvs.push(0,i/seg,1,i/seg);
  }
  for(let i=0;i<seg;i++){ const a=i*2,b=i*2+1,c=((i+1)%seg)*2,d=((i+1)%seg)*2+1; idx.push(a,c,d); idx.push(a,d,b); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(idx);
  return geo;
}

function addGuardRails(points){
  const mat = new THREE.MeshLambertMaterial({color:0xaaaaaa});
  for(let i=0;i<points.length;i+=8){
    const p = points[i];
    const next = points[(i+1)%points.length];
    const forward = new THREE.Vector3().subVectors(next,p).normalize();
    const left = new THREE.Vector3(-forward.z,0,forward.x);
    for(let side of [1,-1]){
      const pos = new THREE.Vector3().addVectors(p, left.clone().multiplyScalar(side * (TUNING.roadWidth + 1.0)));
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.6,0.2), mat);
      rail.position.set(pos.x,0.35,pos.z);
      rail.lookAt(new THREE.Vector3().addVectors(pos, forward));
      scene.add(rail);
    }
  }
}

function addHillsAndTrees(){
  const treeMat = new THREE.MeshLambertMaterial({color:0x115511});
  const trunkMat = new THREE.MeshLambertMaterial({color:0x6b3b07});
  for(let i=0;i<120;i++){
    const a = Math.random()*Math.PI*2;
    const r = 60 + Math.random()*180;
    const x = Math.cos(a)*r; const z = Math.sin(a)*r;
    const y = Math.max(0.2, (Math.random()-0.4)*3);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,2,6), trunkMat);
    trunk.position.set(x,y/2,z);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*1.5,4,6), treeMat);
    leaves.position.set(x,y+2,z);
    scene.add(trunk); scene.add(leaves);
  }
}

function createCar(){
  const group = new THREE.Group();
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0,0.6,4.0), new THREE.MeshLambertMaterial({color:0x1e90ff}));
  body.position.y = 0.7;
  group.add(body);
  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4,0.5,1.8), new THREE.MeshLambertMaterial({color:0x88ccff}));
  cabin.position.set(0,1.0,0);
  group.add(cabin);
  // Wheels (visual)
  const wheelGeo = new THREE.CylinderGeometry(0.35,0.35,0.5,8);
  const wheelMat = new THREE.MeshLambertMaterial({color:0x222222});
  const offsets = [[1,-0.2,1.5],[-1,-0.2,1.5],[1,-0.2,-1.5],[-1,-0.2,-1.5]];
  for(let o of offsets){ const w = new THREE.Mesh(wheelGeo,wheelMat); w.rotation.z = Math.PI/2; w.position.set(o[0],o[1],o[2]); group.add(w); }
  return { group, position: new THREE.Vector3(), velocity: new THREE.Vector3(), heading: 0, driftScore:0 };
}

function animate(now=performance.now()){
  const dt = Math.min(0.05, (now - lastTime)/1000);
  lastTime = now;
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function update(dt){
  handleInput(dt);
  simulateCar(dt);
  updateCamera(dt);
  updateHUD();
  updateSkidMarks(dt);
}

function handleInput(dt){
  // Map keys
  const acc = (keys['w']||keys['arrowup']) ? 1 : 0;
  const brake = (keys['s']||keys['arrowdown']) ? 1 : 0;
  const steerL = (keys['a']||keys['arrowleft']) ? 1 : 0;
  const steerR = (keys['d']||keys['arrowright']) ? 1 : 0;
  const handbrake = keys[' '];
  if(keys['r']) resetToTrack();
  car._input = {acc,brake,steer:steerR-steerL,handbrake};
}

function simulateCar(dt){
  // Simple arcade vehicle with lateral slip
  const c = car;
  const inp = c._input || {acc:0,brake:0,steer:0,handbrake:false};
  const forward = new THREE.Vector3(Math.sin(c.heading),0,Math.cos(c.heading));

  // Longitudinal acceleration
  let forwardSpeed = c.velocity.dot(forward);
  if(inp.acc && forwardSpeed < TUNING.maxSpeed) forwardSpeed += TUNING.acceleration * dt;
  if(inp.brake) forwardSpeed -= TUNING.braking * dt;
  // Natural drag
  forwardSpeed -= Math.sign(forwardSpeed) * TUNING.drag * dt;
  // Clamp
  forwardSpeed = Math.max(-TUNING.reverseSpeed, Math.min(TUNING.maxSpeed, forwardSpeed));

  // Steering changes heading; stronger at higher steer input and speed
  const steerAmount = inp.steer * TUNING.steeringMax * (1 + forwardSpeed * TUNING.steeringSpeedFactor);
  c.heading += steerAmount * dt;

  // Velocity vector updated: maintain speed along previous velocity but with lateral slip
  // Apply lateral grip to remove sideways velocity component
  const vel = c.velocity.clone();
  const velForward = forward.clone().multiplyScalar(vel.dot(forward));
  const lateral = vel.clone().sub(velForward);
  const grip = inp.handbrake ? TUNING.handbrakeGrip : (isDrifting(c) ? TUNING.driftGrip : TUNING.grip);
  // Reduce lateral by grip factor
  lateral.multiplyScalar(Math.max(0, 1 - grip * dt));
  c.velocity.copy(velForward.add(lateral));

  // Ensure forward component matches forwardSpeed
  const newForwardComp = forward.clone().multiplyScalar(forwardSpeed);
  // Blend between current and target forward component for smoother handling
  c.velocity.add(newForwardComp.sub(velForward).multiplyScalar(0.5));

  // Update position
  c.position.addScaledVector(c.velocity, dt);
  c.group.position.set(c.position.x, 0, c.position.z);
  c.group.rotation.y = c.heading;

  // Off-road penalty
  const {closest, dist, idx} = nearestPointOnTrack(c.position);
  if(dist > TUNING.roadWidth){
    // push gently back and reduce speed
    const push = new THREE.Vector3().subVectors(closest, c.position).setY(0).multiplyScalar(0.02);
    c.position.add(push);
    c.velocity.multiplyScalar(0.94);
  }

  // Guard rail collision simple: if beyond roadWidth+0.9, bounce
  if(dist > TUNING.roadWidth + 1.0){
    c.velocity.multiplyScalar(-0.4);
    c.heading += (Math.random()-0.5)*0.6;
    c.position.add(new THREE.Vector3((Math.random()-0.5)*0.4,0,(Math.random()-0.5)*0.4));
  }

  // Skid mark spawn when lateral slip is large
  const slipAngle = lateral.length() / Math.max(0.001, c.velocity.length());
  if((slipAngle > 0.3 && c.velocity.length()>5) || (inp.handbrake && Math.abs(inp.steer)>0.1 && c.velocity.length()>3)){
    spawnSkid(c.position.clone(), c.velocity.clone());
    c.driftScore = (c.driftScore||0) + Math.floor(Math.abs(slipAngle*10));
  }

  // Lap detection: crossing a fixed segment near point 0
  detectLap(c.position, idx, forward);
}

function isDrifting(c){
  // measure lateral component ratio
  const forward = new THREE.Vector3(Math.sin(c.heading),0,Math.cos(c.heading));
  const lat = c.velocity.clone().projectOnPlane(forward).length();
  return lat > 2.0 && c.velocity.length()>6;
}

function nearestPointOnTrack(pos){
  // brute-force search across sampled track points
  let best = {dist:1e9, closest:null, idx:0};
  for(let i=0;i<track.points.length;i++){
    const p = track.points[i];
    const d = p.distanceToSquared(pos);
    if(d < best.dist){ best.dist = d; best.closest = p; best.idx = i; }
  }
  best.dist = Math.sqrt(best.dist);
  return best;
}

function spawnSkid(pos, vel){
  const dir = vel.clone().normalize();
  const angle = Math.atan2(dir.x, dir.z);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.4), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.8}));
  g.rotation.x = -Math.PI/2; g.rotation.z = -angle;
  g.position.set(pos.x,0.02,pos.z);
  g.renderOrder = 999;
  scene.add(g);
  skidMarks.push({mesh:g, life:2.5});
}

function updateSkidMarks(dt){
  for(let i = skidMarks.length-1;i>=0;i--){
    const s = skidMarks[i];
    s.life -= dt;
    s.mesh.material.opacity = Math.max(0, s.life/2.5)*0.8;
    if(s.life <= 0){ scene.remove(s.mesh); skidMarks.splice(i,1); }
  }
}

function updateCamera(dt){
  const camTarget = new THREE.Vector3().copy(car.position);
  const behind = new THREE.Vector3(Math.sin(car.heading),0,Math.cos(car.heading)).multiplyScalar(-TUNING.cameraDistance);
  camTarget.add(behind);
  camTarget.y += TUNING.cameraHeight;
  // Smooth follow
  camera.position.lerp(camTarget, 1 - Math.exp(-TUNING.cameraLag*60*dt));
  // Look slightly ahead of car
  const lookAt = new THREE.Vector3().copy(car.position).add(new THREE.Vector3(Math.sin(car.heading),0,Math.cos(car.heading)).multiplyScalar(6));
  camera.lookAt(lookAt);
  // camera shake
  const speed = car.velocity.length();
  const shake = Math.max(0, (speed - TUNING.cameraShakeAtSpeed)/20);
  if(shake>0){ const sX = (Math.random()-0.5)*shake; const sY=(Math.random()-0.5)*shake*0.4; camera.position.x += sX; camera.position.y += sY; }
}

function updateHUD(){
  const speedKmh = Math.round(car.velocity.length()*3.6);
  hud.speed.textContent = `${speedKmh} km/h`;
  hud.drift.textContent = `DRIFT: ${car.driftScore||0}`;
  hud.lap.textContent = `Lap: ${lapState.laps}`;
  // time
  const t = (performance.now() - lapState.startTime);
  hud.time.textContent = msToTime(t);
}

function msToTime(ms){
  const s = Math.floor(ms/1000); const msr = Math.floor(ms%1000);
  const mm = Math.floor(s/60); const ss = s%60;
  return `${pad(mm,2)}:${pad(ss,2)}.${pad(msr,3)}`;
}
function pad(n,l){ return n.toString().padStart(l,'0'); }

function detectLap(pos, idx, forwardVec){
  // Use a small segment between track.points[0] and next as start/finish
  const a = track.points[0]; const b = track.points[8];
  const seg = {a,b};
  // Check if car crosses the segment (simple projection test)
  const side = Math.sign((b.x-a.x)*(pos.z-a.z) - (b.z-a.z)*(pos.x-a.x));
  const prevSide = lapState.lastSide || 0;
  if(prevSide !== 0 && side !== prevSide){
    // crossed; ensure heading roughly forward along track tangent
    const tangent = new THREE.Vector3().subVectors(track.points[1], track.points[0]).normalize();
    const forwardDot = forwardVec.dot(tangent);
    if(forwardDot > 0){ // forward crossing
      const now = performance.now();
      if(lapState.lastCross){
        const lapTime = now - lapState.lastCross;
        if(!lapState.best || lapTime < lapState.best) lapState.best = lapTime;
      }
      lapState.laps += 1;
      lapState.lastCross = now;
    }
  }
  lapState.lastSide = side;
}

function resetToTrack(){
  const p = track.points[0];
  car.position.set(p.x,0,p.z);
  car.velocity.set(0,0,0);
  car.heading = Math.atan2(track.points[1].x - track.points[0].x, track.points[1].z - track.points[0].z);
  car.group.position.set(car.position.x,0,car.position.z);
  car.group.rotation.y = car.heading;
}

// Provide basic instructions for running in comments
/*
Run: Open index.html in Chrome (no build step).
Tuning constants are at the top of this file in the TUNING object.
*/
