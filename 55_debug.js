// server_scripts/ships/55_debug.js
// Debug helpers for KubeVS bridge & tracking. Rhino-safe (no top-level const duplicates).

ServerEvents.commandRegistry(event => {
  var Commands = Java.loadClass('net.minecraft.commands.Commands');
  var StringArg = Java.loadClass('com.mojang.brigadier.arguments.StringArgumentType');
  var AABB = Java.loadClass('net.minecraft.world.phys.AABB');

  function resolveTrackedShip(id){
    if (!global.SHIPS_TRACK) return null;
    var st = global.SHIPS_TRACK[id];
    if (!st) return null;
    if (typeof global._shipsTrackerResolveCenter === 'function') {
      try { global._shipsTrackerResolveCenter(st); } catch(_){ }
    }
    return st;
  }

  function liveCenter(st){
    if (!st) return { x:0, y:0, z:0 };
    if (st.lastCenterWorld) return st.lastCenterWorld;
    if (typeof global._shipsTrackerResolveCenter === 'function') {
      try { global._shipsTrackerResolveCenter(st); } catch(_){ }
      if (st.lastCenterWorld) return st.lastCenterWorld;
    }
    var c = null;
    try { c = KubeVS.shipCenterWorld(st.ship); } catch(_){ }
    if (c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z) && !(c.x===0 && c.y===0 && c.z===0)) {
      return { x:+c.x, y:+c.y, z:+c.z };
    }
    return { x:+(st.anchorX||0), y:+(st.anchorY||0), z:+(st.anchorZ||0) };
  }

  function findShipAt(level, x, y, z){
    try {
      var box = new AABB(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1);
      var ships = KubeVS.shipsInAABB(level, box) || [];
      if (ships && ships.length > 0) return ships[0];
    } catch(_){ }
    return null;
  }

  event.register(
    Commands.literal('shipdebug')
      .requires(cs => cs.hasPermission(2))

      // /shipdebug kubevs
      .then(
        Commands.literal('kubevs')
          .executes(ctx => {
            try {
              var s = ctx.source.server;
              var keys = [];
              if (typeof KubeVS === 'object' && KubeVS) {
                for (var k in KubeVS) {
                  try { keys.push(k + ':' + (typeof KubeVS[k])); } catch (_){}
                }
              }
              keys.sort();
              s.tell(Text.gray('[ShipDebug] KubeVS keys: ' + (keys.length ? keys.join(', ') : '(none)')));

              var candidates = [
                'org.valkyrienskies.mod.common.VSGameUtilsKt',
                'org.valkyrienskies.mod.common.util.VSGameUtilsKt',
                'org.valkyrienskies.core.impl.game.ships.ShipWorldKt',
                'org.valkyrienskies.core.util.ShipUtilsKt'
              ];
              var present = [];
              for (var i = 0; i < candidates.length; i++) {
                try { if (Java.loadClass(candidates[i])) present.push(candidates[i]); } catch (_){}
              }
              s.tell(Text.gray('[ShipDebug] Present classes: ' + (present.length ? present.join(', ') : '(none)')));
            } catch (e) {
              try { ctx.source.server.tell(Text.red('[ShipDebug] kubevs reflect error: ' + e)); } catch (_){}
            }
            return 1;
          })
      )

      // /shipdebug reinit  -> rebuild the bridge right now
      .then(
        Commands.literal('reinit')
          .executes(ctx => {
            try {
              if (!KubeVS || typeof KubeVS._reinit !== 'function') throw new Error('Bridge not present');
              KubeVS._reinit();
              ctx.source.server.tell(Text.yellow('[ShipDebug] Bridge reinitialized.'));
            } catch (e) {
              ctx.source.server.tell(Text.red('[ShipDebug] reinit error: ' + e));
            }
            return 1;
          })
      )

      // /shipdebug wire <full.java.Class> <staticMethod>
      .then(
        Commands.literal('wire')
          .then(
            Commands.argument('class', StringArg.string())
              .then(
                Commands.argument('method', StringArg.string())
                  .executes(ctx => {
                    var clsName = StringArg.getString(ctx, 'class');
                    var mName   = StringArg.getString(ctx, 'method');
                    try {
                      if (!KubeVS || typeof KubeVS._forceWire !== 'function') throw new Error('Bridge not ready');
                      var ok = KubeVS._forceWire(clsName, mName);
                      ctx.source.server.tell(Text.yellow('[ShipDebug] forceWire(' + clsName + '.' + mName + '): ' + (ok ? 'OK' : 'FAILED')));
                    } catch (e) {
                      ctx.source.server.tell(Text.red('[ShipDebug] forceWire error: ' + e));
                    }
                    return 1;
                  })
              )
          )
      )

      // /shipdebug remove_here
      .then(
        Commands.literal('remove_here')
          .executes(ctx => {
            try {
              var p = ctx.source.player;
              var lvl = p.level;
              var aabbCls = Java.loadClass('net.minecraft.world.phys.AABB');
              var rx=1, ry=1, rz=1;
              var box = new aabbCls(p.x - rx, p.y - ry, p.z - rz, p.x + rx, p.y + ry, p.z + rz);
              var ships = KubeVS.shipsInAABB(lvl, box) || [];
              if (!ships || ships.length===0){ ctx.source.server.tell(Text.red('[ShipDebug] No ship found at your position.')); return 1; }
              var ship = ships[0];
              var id = 'unknown'; try { id = String(KubeVS.shipId(ship)); } catch(_i){}
              var slug = null; try { slug = KubeVS.shipSlug(ship); } catch(_s){}
              var ok=false, via='';
              try { ok = !!KubeVS.removeShip(lvl, ship); via='attachment'; } catch(_a){}
              if (!ok && slug){ try { lvl.runCommandSilent('vs ship delete '+slug); ok=true; via='command-slug:'+slug; } catch(_cs){} }
              if (!ok){ try { lvl.runCommandSilent('vs ship delete '+id); ok=true; via='command-id:'+id; } catch(_ci){} }
              ctx.source.server.tell(Text.yellow('[ShipDebug] remove_here id='+id+' slug='+(slug||'(none)')+' ok='+ok+' via='+via));
            } catch (e) {
              ctx.source.server.tell(Text.red('[ShipDebug] remove_here error: ' + e));
            }
            return 1;
          })
      )

      // /shipdebug centerblock
      .then(
        Commands.literal('centerblock')
          .executes(ctx => {
            try {
              var p = ctx.source.player;
              var lvl = p.level;
              var ship = findShipAt(lvl, p.x, p.y, p.z);
              if (!ship){ ctx.source.server.tell(Text.red('[ShipDebug] No ship found near player.')); return 1; }
              var st = { level:lvl, ship:ship, anchorX:p.x|0, anchorY:p.y|0, anchorZ:p.z|0 };
              var center = liveCenter(st);
              var shipCenter = st.lastCenterShip || {x:0,y:0,z:0};

              var now = null;
              try {
                var src = lvl.getChunkSource && lvl.getChunkSource();
                if (src && typeof src.getChunkNow === 'function') now = src.getChunkNow(Math.floor(center.x/16), Math.floor(center.z/16)) != null;
              } catch(_){ }

              var bs = null, id = null, err = null;
              try { bs = lvl.getBlock(Math.floor(center.x), Math.floor(center.y), Math.floor(center.z)); } catch(e) { err = String(e); }
              try { if (bs && bs.id) id = String(bs.id); } catch(_){ }

              ctx.source.server.tell(Text.yellow('[ShipDebug] center '+center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2)+
                ' ship='+shipCenter.x.toFixed(2)+','+shipCenter.y.toFixed(2)+','+shipCenter.z.toFixed(2)+
                ' getChunkNow='+(now===null?'(n/a)':now)+
                ' block='+(bs===null?'null':'obj')+' id='+(id||'(none)')+(err?(' err='+err):'')));
            } catch (e) {
              ctx.source.server.tell(Text.red('[ShipDebug] centerblock error: ' + e));
            }
            return 1;
          })
      )

      // /shipdebug status_all
      .then(
        Commands.literal('status_all')
          .executes(function(ctx){
            try {
              var server = ctx.source.server;
              var keys = Object.keys(global.SHIPS_TRACK||{});
              if (keys.length === 0) { server.tell(Text.gray('[ShipDebug] no tracked ships')); return 1; }
              for (var i=0;i<keys.length;i++){
                var id = keys[i];
                var st = resolveTrackedShip(id);
                if (!st || !st.level) continue;
                var slug = null; try { slug = KubeVS.shipSlug(st.ship); } catch(_){ }
                if (!slug && st.slug) slug = st.slug;
                var center = liveCenter(st);
                var shipCenter = st.lastCenterShip || null;

                var now = null;
                try {
                  var src = st.level.getChunkSource && st.level.getChunkSource();
                  if (src && typeof src.getChunkNow === 'function') now = src.getChunkNow(Math.floor(center.x/16), Math.floor(center.z/16)) != null;
                } catch(_){ }

                server.tell(Text.gray('[ShipDebug] id='+id+' slug='+(slug||'(none)')+' center='+
                  center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2)+
                  (shipCenter ? (' ship='+shipCenter.x.toFixed(2)+','+shipCenter.y.toFixed(2)+','+shipCenter.z.toFixed(2)) : '')+
                  ' getChunkNow='+(now===null?'(n/a)':now)+
                  ' numeric='+(st.numericId!==undefined?st.numericId:'(n/a)')));
              }
            } catch (e) {
              ctx.source.server.tell(Text.red('[ShipDebug] status_all error: ' + e));
            }
            return 1;
          })
      )

      // /shipdebug centerblock_id <idOrSlug>
      .then(
        Commands.literal('centerblock_id')
          .then(
            Commands.argument('key', StringArg.string())
              .executes(function(ctx){
                try {
                  var key = StringArg.getString(ctx, 'key');
                  var server = ctx.source.server;
                  var target = null;
                  var keys = Object.keys(global.SHIPS_TRACK||{});
                  for (var i=0;i<keys.length;i++){
                    var idCandidate = keys[i];
                    var stCandidate = resolveTrackedShip(idCandidate);
                    if (!stCandidate) continue;
                    var slug=null; try { slug=KubeVS.shipSlug(stCandidate.ship); } catch(_){ }
                    if (!slug && stCandidate.slug) slug = stCandidate.slug;
                    if (idCandidate===key || (slug && slug===key)) { target = { id:idCandidate, st: stCandidate }; break; }
                  }
                  if (!target){ server.tell(Text.red('[ShipDebug] no tracked ship matching '+key)); return 1; }
                  var st = target.st;
                  var center = liveCenter(st);
                  var shipCenter = st.lastCenterShip || null;

                  var now = null;
                  try {
                    var src = st.level.getChunkSource && st.level.getChunkSource();
                    if (src && typeof src.getChunkNow === 'function') now = src.getChunkNow(Math.floor(center.x/16), Math.floor(center.z/16)) != null;
                  } catch(_){ }

                  var bs=null, bid=null, err=null;
                  try { bs = st.level.getBlock(Math.floor(center.x),Math.floor(center.y),Math.floor(center.z)); } catch(e){ err=String(e); }
                  try { if (bs && bs.id) bid=String(bs.id); } catch(_){ }
                  server.tell(Text.yellow('[ShipDebug] centerblock_id id='+target.id+' center='+
                    center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2)+
                    (shipCenter ? (' ship='+shipCenter.x.toFixed(2)+','+shipCenter.y.toFixed(2)+','+shipCenter.z.toFixed(2)) : '')+
                    ' getChunkNow='+(now===null?'(n/a)':now)+
                    ' block='+(bs===null?'null':'obj')+' id='+(bid||'(none)')+(err?(' err='+err):'')+
                    ' numeric='+(st.numericId!==undefined?st.numericId:'(n/a)')+
                    ' slug='+(st.slug||'(none)')));
                } catch (e) {
                  ctx.source.server.tell(Text.red('[ShipDebug] centerblock_id error: ' + e));
                }
                return 1;
              })
          )
      )
      .then(
        Commands.literal('dump_state')
          .executes(ctx => {
            try {
              var server = ctx.source.server;
              var stateFn = (typeof global._shipsTrackerState === 'function') ? global._shipsTrackerState : null;
              var state = stateFn ? stateFn() : (global.SHIPS_TRACK || {});
              var keys = Object.keys(state || {});
              server.tell(Text.gray('[ShipDebug] tracker entries='+keys.length));
              for (var i=0;i<keys.length;i++){
                var id = keys[i];
                var st = state[id];
                if (!st) continue;
                var slug = st.slug || null;
                var world = st.lastCenterWorld || {x:0,y:0,z:0};
                var ship = st.lastCenterShip || {x:0,y:0,z:0};
                var msg = 'id='+id+' slug='+(slug||'(none)')+' numeric='+(st.numericId!==undefined?st.numericId:'(n/a)')+
                  ' world='+world.x+','+world.y+','+world.z+
                  ' ship='+ship.x+','+ship.y+','+ship.z+
                  ' anchor='+st.anchorX+','+st.anchorY+','+st.anchorZ;
                server.tell(Text.gray('[ShipDebug] '+msg));
              }
            } catch (e) {
              ctx.source.server.tell(Text.red('[ShipDebug] dump_state error: ' + e));
            }
            return 1;
          })
      )
  );
});
