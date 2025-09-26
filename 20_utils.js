// ships/20_utils.js
// Helper utilities (Rhino-friendly)

function Ships_toInt(n){ var v=Number(n); return isFinite(v)?Math.floor(v):null; }
function Ships_coerceTries(n,f){ var v=Math.floor(Number(n)); return (isFinite(v)&&v>=1)?v:f; }
function Ships_randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

function Ships_broadcast(server,msg){
  var CFG = global.Ships_CFG;
  if(!CFG.DEBUG||!server||!server.players) return;
  var t=(typeof msg==='string')?Text.gray(msg):msg;
  for(var i=0;i<server.players.length;i++) try{ server.players[i].tell(t);}catch(e){}
}

function Ships_getBlockSafe(level,x,y,z){
  var xi=Ships_toInt(x), yi=Ships_toInt(y), zi=Ships_toInt(z);
  if(xi===null||yi===null||zi===null) return null;
  if(yi<level.minBuildHeight||yi>level.maxBuildHeight) return null;
  try{ return level.getBlock(xi,yi,zi);}catch(e){ return null; }
}

function Ships_isWater(level,x,y,z){
  var bs=Ships_getBlockSafe(level,x,y,z);
  return bs && bs.id==='minecraft:water';
}

function Ships_hasWaterPad(level,x,y,z,r){
  for(var dx=-r;dx<=r;dx++){
    for(var dz=-r;dz<=r;dz++){
      if(!Ships_isWater(level,x+dx,y,z+dz)) return false;
      if(Ships_isWater(level,x+dx,y+1,z+dz)) return false;
    }
  } return true;
}

function Ships_hasWaterDepth(level,x,y,z,depth){
  for(var i=0;i<depth;i++){ if(!Ships_isWater(level,x,y-i,z)) return false; }
  return true;
}

function Ships_findWaterSurfaceY(level,x,z){
  var CFG = global.Ships_CFG;
  var top=Math.min(CFG.Y_SCAN_TOP, level.maxBuildHeight-2);
  var bottom=Math.max(CFG.Y_SCAN_BOTTOM, level.minBuildHeight+2);
  for(var y=top;y>=bottom;y--){
    if(Ships_isWater(level,x,y,z) && !Ships_isWater(level,x,y+1,z)) return y;
  } return null;
}

function Ships_effectiveMaxRadius(){
  var CFG = global.Ships_CFG;
  var max=CFG.MAX_RADIUS;
  if(CFG.REQUIRE_LOADED) max=Math.min(max, Math.max(0, CFG.LOADED_RADIUS_BLOCKS - 4));
  return Math.max(CFG.MIN_RADIUS, max);
}

function Ships_pickRingOffset(){
  var CFG = global.Ships_CFG;
  var maxEff = Ships_effectiveMaxRadius();
  if (CFG.MIN_RADIUS > maxEff) return null;
  var min2=CFG.MIN_RADIUS*CFG.MIN_RADIUS;
  var max2=maxEff*maxEff;

  for(var tries=0; tries<8; tries++){
    var dx=Ships_randInt(-maxEff, maxEff);
    var dz=Ships_randInt(-maxEff, maxEff);
    var d2=dx*dx+dz*dz;
    if(d2>=min2 && d2<=max2) return {dx:dx, dz:dz, d2:d2, max2:max2};
  }
  var edge=maxEff;
  switch(Ships_randInt(0,3)){
    case 0: return {dx: edge, dz: Ships_randInt(-edge, edge), d2: edge*edge, max2: edge*edge};
    case 1: return {dx:-edge, dz: Ships_randInt(-edge, edge), d2: edge*edge, max2: edge*edge};
    case 2: return {dx: Ships_randInt(-edge, edge), dz: edge, d2: edge*edge, max2: edge*edge};
    default:return {dx: Ships_randInt(-edge, edge), dz:-edge, d2: edge*edge, max2: edge*edge};
  }
}

// expose
global.Ships_utils = {
  toInt: Ships_toInt,
  coerceTries: Ships_coerceTries,
  randInt: Ships_randInt,
  broadcast: Ships_broadcast,
  getBlockSafe: Ships_getBlockSafe,
  isWater: Ships_isWater,
  hasWaterPad: Ships_hasWaterPad,
  hasWaterDepth: Ships_hasWaterDepth,
  findWaterSurfaceY: Ships_findWaterSurfaceY,
  effectiveMaxRadius: Ships_effectiveMaxRadius,
  pickRingOffset: Ships_pickRingOffset
};
