// priority: 5

// ships/40_spawner.js
// Spawner + tick driver

var CFG = global.Ships_CFG;
var U = global.Ships_utils;

function Ships_tryCandidate(server, level, px, pz, flags, stats, chanceOverride){
  if(flags.spawned) return;
  stats.attempts++;

  var off = U.pickRingOffset();
  if(!off){
    if(CFG.DEBUG) U.broadcast(server,'[Ships] no valid annulus: MIN_RADIUS='+CFG.MIN_RADIUS+' > effectiveMax='+U.effectiveMaxRadius()+' (raise LOADED_RADIUS_BLOCKS or lower MIN_RADIUS)');
    stats.badCoord++; return;
  }
  var x = U.toInt(Number(px)+off.dx);
  var z = U.toInt(Number(pz)+off.dz);
  if(x===null||z===null){
    U.broadcast(server,'[Ships] bad coords (NaN) px='+px+' pz='+pz+' dx='+off.dx+' dz='+off.dz);
    stats.badCoord++; return;
  }

  stats.tried++;
  U.broadcast(server,'[Ships] Candidate @ '+x+','+z+' (dx='+off.dx+', dz='+off.dz+')');

  var ySurf = U.findWaterSurfaceY(level, x, z);
  if(ySurf===null){ U.broadcast(server,'  → no water surface in scan window'); return; }
  stats.foundSurface++;

  if(!U.hasWaterPad(level,x,ySurf,z,CFG.WATER_PAD_RADIUS)){
    U.broadcast(server,'  → surface @ Y='+ySurf+', but not enough open water pad'); return;
  }
  stats.padOK++;

  if(!U.hasWaterDepth(level,x,ySurf,z,CFG.MIN_WATER_DEPTH)){
    U.broadcast(server,'  → surface @ Y='+ySurf+', but depth < '+CFG.MIN_WATER_DEPTH); return;
  }
  stats.depthOK++;

  var p = (typeof chanceOverride==='number') ? chanceOverride : CFG.CHANCE;
  if(Math.random()>p){ U.broadcast(server,'  → roll failed'); return; }
  stats.rollPass++;

  // Only now remove old ships (no pirates or unloaded)
  try{ if (global.SHIPS_removeOldShips) { var n=global.SHIPS_removeOldShips(); if (n>0 && CFG.DEBUG) U.broadcast(server,'  → removed '+n+' old ship(s)'); } }catch(_rm){}

  var cmd='/execute in minecraft:overworld positioned '+x+' '+ySurf+' '+z+' run place structure '+CFG.STRUCTURE_ID;
  level.runCommandSilent(cmd);

  // hook KubeVS tracker 40 ticks later
  try{
    if (global.Ships_onStructurePlaced){
      global.Ships_schedule(server, 40, function(){
        try{ global.Ships_onStructurePlaced(level, x, ySurf, z); }catch(e){}
      });
    }
  }catch(e){}

  flags.spawned=true;
  stats.placed++;
  try{ server.tell(Text.yellow('✓ [Ships] placed at '+x+','+ySurf+','+z)); }catch(e){}
}

function Ships_runCycle(server, opts){
  var players = server.players;
  if(!players || players.length===0) return;

  try {
    if (global.SHIPS_canSpawn && !global.SHIPS_canSpawn()) {
      if(CFG.DEBUG) U.broadcast(server,'[Ships] blocked: existing loaded ship');
      return;
    }
  }catch(_g){}

  var stats={attempts:0,badCoord:0,tried:0,foundSurface:0,padOK:0,depthOK:0,rollPass:0,placed:0};
  var flags={spawned:false};

  var TRIES = U.coerceTries((opts && opts.triesPerPlayerOverride) || CFG.TRIES_PER_PLAYER, 4);
  try{
    server.tell(Text.gray('[Ships] Players online: '+players.length+
      ' | tries per player: '+TRIES+
      ' | ring ['+CFG.MIN_RADIUS+','+U.effectiveMaxRadius()+'] (loaded='+CFG.REQUIRE_LOADED+')'));
  }catch(e0){}

  for(var i=0;i<players.length && !flags.spawned;i++){
    var p=players[i];
    if(p.isSpectator && p.isSpectator()){ if(CFG.DEBUG) try{ server.tell(Text.gray('[Ships] skip '+p.name.string+': spectator')); }catch(e1){} continue; }

    var level=p.level; if(!level){ if(CFG.DEBUG) try{ server.tell(Text.gray('[Ships] skip '+p.name.string+': no level')); }catch(e2){} continue; }

    var dimStr=String(level.dimension||'');
    var isOverworld=(dimStr.indexOf(':overworld')===dimStr.length-':overworld'.length)||(dimStr==='minecraft:overworld')||(dimStr==='overworld');
    if(!isOverworld){ if(CFG.DEBUG) try{ server.tell(Text.gray('[Ships] skip '+p.name.string+': dim='+dimStr)); }catch(e3){} continue; }

    var px=U.toInt(p.x), pz=U.toInt(p.z);
    if(px===null||pz===null){ if(CFG.DEBUG) try{ server.tell(Text.gray('[Ships] skip '+p.name.string+': bad pos x='+p.x+' z='+p.z)); }catch(e4){} continue; }

    if(CFG.DEBUG || (opts && opts.verbose)) try{ server.tell(Text.gray('[Ships] sampling around '+p.name.string+' at '+px+','+pz+' in '+dimStr)); }catch(e5){}

    for(var t=0;t<TRIES && !flags.spawned;t++){
      if(CFG.DEBUG || (opts && opts.verbose)) U.broadcast(server,'  … attempt '+(t+1)+' / '+TRIES);
      Ships_tryCandidate(server, level, px, pz, flags, stats, opts ? opts.forceChance : undefined);
    }
  }

  try{
    server.tell(Text.aqua('[Ships] Cycle: attempts='+stats.attempts+
      ', badCoord='+stats.badCoord+
      ', tried='+stats.tried+
      ', surface='+stats.foundSurface+
      ', pad='+stats.padOK+
      ', depth='+stats.depthOK+
      ', roll='+stats.rollPass+
      ', placed='+stats.placed));
  }catch(e6){}
  try{ server.tell(Text.aqua('[Ships] Cycle complete. '+(flags.spawned?'Spawned 1.':'No spawn.'))); }catch(e7){}
}

// Tick driver (also processes our simple timer queue)
ServerEvents.tick(event=>{
  var CFG = global.Ships_CFG;
  var t = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) + 1;
  global.Ships__setTick(t);

  try{ if (global.Ships_processTimers) global.Ships_processTimers(event.server); }catch(e){}

  if (t % CFG.TICKS_BETWEEN_TRIES !== 0) return;
  Ships_runCycle(event.server, null);
});

// expose runCycle to commands
global.Ships_runCycle = Ships_runCycle;

// Wire-up: after a structure is placed, ask the tracker to resolve & begin tracking
if (!global.Ships_onStructurePlaced) {
  global.Ships_onStructurePlaced = function(level, x, y, z){
    try {
      if (typeof global.SHIPS_trackAt === 'function') {
        global.SHIPS_trackAt(level, x, y, z);
      }
    } catch(_){}
  };
}
