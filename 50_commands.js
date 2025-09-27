// ships/50_commands.js
// Consolidated /ships command system

var Commands = Java.loadClass('net.minecraft.commands.Commands');
var StringArgumentType = Java.loadClass('com.mojang.brigadier.arguments.StringArgumentType');

ServerEvents.commandRegistry(event=>{
  event.register(
    Commands.literal('ships')
      .requires(cs => cs.hasPermission(2))
      
      // === SPAWNING ===
      .then(
        Commands.literal('check')
          .executes(ctx => {
            try{ global.Ships_runCycle(ctx.source.server, { verbose:true }); }catch(e){}
            return 1;
          })
      )
      .then(
        Commands.literal('force')
          .executes(ctx => {
            try{ global.Ships_runCycle(ctx.source.server, { triesPerPlayerOverride: 12, forceChance: 1.0, verbose:true }); }catch(e){}
            return 1;
          })
      )
      
      // === TRACKING ===
      .then(
        Commands.literal('track')
          .then(
            Commands.literal('here')
              .executes(ctx => {
                var p = ctx.source.player;
                if (!p) { ctx.source.server.tell('§cPlayer required'); return 0; }
                var lvl = p.level;
                var px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
                if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                  ctx.source.server.tell('§7[Ships] Tracking at '+px+','+py+','+pz);
                }
                global.SHIPS_trackAt(lvl, px, py, pz);
                return 1;
              })
          )
          .then(
            Commands.literal('list')
              .executes(ctx => {
                var server = ctx.source.server;
                var keys = Object.keys(global.SHIPS_TRACK || {});
                var out = [];
                for (var i=0;i<keys.length;i++){
                  var id = keys[i];
                  var st = global.SHIPS_TRACK[id];
                  if (!st) continue;
                  var center = st.lastCenterWorld || {x:0,y:0,z:0};
                  out.push(id+'@'+center.x.toFixed(1)+','+center.y.toFixed(1)+','+center.z.toFixed(1));
                }
                server.tell('§7[Ships] Tracked: '+(out.length?out.join(', '):'(none)'));
                return 1;
              })
          )
          .then(
            Commands.literal('status')
              .executes(ctx => {
                try {
                  var server = ctx.source.server;
                  var keys = Object.keys(global.SHIPS_TRACK || {});
                  server.tell('§7[Ships] Status for '+keys.length+' tracked ships:');
                  for (var i=0;i<keys.length;i++){
                    var id = keys[i];
                    var st = global.SHIPS_TRACK[id];
                    if (!st || !st.level) continue;
                    var center = st.lastCenterWorld || {x:0,y:0,z:0};
                    var slug = st.slug || 'unknown';
                    var chunkLoaded = false;
                    try {
                      var chunkX = Math.floor(center.x / 16);
                      var chunkZ = Math.floor(center.z / 16);
                      chunkLoaded = st.level.getChunkSource().getChunkNow(chunkX, chunkZ) != null;
                    } catch(_){}
                    server.tell('§7[Ships] id='+id+' slug='+slug+' center='+center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2)+' loaded='+chunkLoaded);
                  }
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] Status error: ' + e);
                  }
                }
                return 1;
              })
          )
      )
      
      // === DEBUG ===
      .then(
        Commands.literal('debug')
          .then(
            Commands.literal('on')
              .executes(ctx => {
                global.TRACK_DBG = true;
                global.DEBUG = true;
                if (global.Ships_CFG) global.Ships_CFG.DEBUG = true;
                ctx.source.server.tell('§e[Ships] Debug enabled');
                return 1;
              })
          )
          .then(
            Commands.literal('off')
              .executes(ctx => {
                global.TRACK_DBG = false;
                global.DEBUG = false;
                if (global.Ships_CFG) global.Ships_CFG.DEBUG = false;
                ctx.source.server.tell('§e[Ships] Debug disabled');
                return 1;
              })
          )
          .then(
            Commands.literal('status')
              .executes(ctx => {
                var debugOn = global.TRACK_DBG || global.DEBUG || (global.Ships_CFG && global.Ships_CFG.DEBUG) || false;
                ctx.source.server.tell('§7[Ships] Debug is '+(debugOn?'§aON':'§cOFF'));
                return 1;
              })
          )
          .then(
            Commands.literal('kubevs')
              .executes(ctx => {
                try {
                  var msg = '';
                  if (global.KubeVS) {
                    msg += 'KubeVS: §aavailable§7\n';
                    var methods = ['shipsInAABB','shipId','shipSlug','shipCenterWorld','removeShip'];
                    for (var i=0;i<methods.length;i++) {
                      var m = methods[i];
                      msg += '  '+m+': '+(typeof global.KubeVS[m] === 'function' ? '§aOK' : '§cmissing')+'§7\n';
                    }
                  } else {
                    msg += 'KubeVS: §cmissing§7\n';
                  }
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§7[Ships] '+msg);
                  }
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] KubeVS check error: ' + e);
                  }
                }
                return 1;
              })
          )
          .then(
            Commands.literal('remove_here')
              .executes(ctx => {
                try {
                  var p = ctx.source.player;
                  if (!p) { ctx.source.server.tell('§cPlayer required'); return 0; }
                  var lvl = p.level;
                  var box = new AABB(p.x-10, p.y-5, p.z-10, p.x+10, p.y+5, p.z+10);
                  var ships = global.KubeVS.shipsInAABB(lvl, box) || [];
                  if (ships.length === 0) {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§c[Ships] No ships found here');
                    }
                    return 0;
                  }
                  var ship = ships[0];
                  var id = global.KubeVS.shipId(ship);
                  var slug = global.KubeVS.shipSlug(ship);
                  var ok = global.KubeVS.removeShip(lvl, ship);
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§7[Ships] Remove id='+id+' slug='+slug+' result='+ok);
                  }
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] Remove error: ' + e);
                  }
                }
                return 1;
              })
          )
          .then(
            Commands.literal('center')
              .executes(ctx => {
                try {
                  var p = ctx.source.player;
                  if (!p) { ctx.source.server.tell('§cPlayer required'); return 0; }
                  var lvl = p.level;
                  var box = new AABB(p.x-10, p.y-5, p.z-10, p.x+10, p.y+5, p.z+10);
                  var ships = global.KubeVS.shipsInAABB(lvl, box) || [];
                  if (ships.length === 0) {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§c[Ships] No ships found here');
                    }
                    return 0;
                  }
                  var ship = ships[0];
                  var id = global.KubeVS.shipId(ship);
                  var center = global.KubeVS.shipCenterWorld(ship);
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§7[Ships] id='+id+' center='+center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2));
                  }
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] Center error: ' + e);
                  }
                }
                return 1;
              })
          )
          .then(
            Commands.literal('centerid')
              .then(
                Commands.argument('shipid', StringArgumentType.string())
                  .executes(ctx => {
                    try {
                      var idOrSlug = ctx.getArgument('shipid', String);
                      var keys = Object.keys(global.SHIPS_TRACK || {});
                      var found = null;
                      for (var i=0;i<keys.length && !found;i++){
                        var st = global.SHIPS_TRACK[keys[i]];
                        if (st && (st.id == idOrSlug || st.slug == idOrSlug)) found = st;
                      }
                      if (!found) {
                        if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                          ctx.source.server.tell('§c[Ships] Ship not found: '+idOrSlug);
                        }
                        return 0;
                      }
                      var center = found.lastCenterWorld || {x:0,y:0,z:0};
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§7[Ships] id='+found.id+' slug='+(found.slug||'none')+' center='+center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2));
                      }
                    } catch (e) {
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§c[Ships] CenterID error: ' + e);
                      }
                    }
                    return 1;
                  })
              )
          )
          .then(
            Commands.literal('pirates')
              .executes(ctx => {
                try {
                  var p = ctx.source.player;
                  if (!p) { ctx.source.server.tell('§cPlayer required'); return 0; }
                  var lvl = p.level;
                  var box = new AABB(p.x-10, p.y-5, p.z-10, p.x+10, p.y+5, p.z+10);
                  var ships = global.KubeVS.shipsInAABB(lvl, box) || [];
                  if (ships.length === 0) {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§c[Ships] No ships found here');
                    }
                    return 0;
                  }
                  var ship = ships[0];
                  var id = global.KubeVS.shipId(ship);
                  var pirates = global.KubeVS.entitiesInShip(lvl, ship, 'pirates:pirate') || [];
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§7[Ships] Ship id='+id+' has '+pirates.length+' pirates');
                  }
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] Pirates error: ' + e);
                  }
                }
                return 1;
              })
          )
          .then(
            Commands.literal('decay')
              .executes(ctx => {
                try {
                  var p = ctx.source.player;
                  if (!p) { ctx.source.server.tell('§cPlayer required'); return 0; }
                  var lvl = p.level;
                  var box = new AABB(p.x-10, p.y-5, p.z-10, p.x+10, p.y+5, p.z+10);
                  var ships = global.KubeVS.shipsInAABB(lvl, box) || [];
                  if (ships.length === 0) {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§c[Ships] No ships found here');
                    }
                    return 0;
                  }
                  var ship = ships[0];
                  var id = global.KubeVS.shipId(ship);
                  
                  // Find the tracked ship
                  var st = null;
                  var keys = Object.keys(global.SHIPS_TRACK || {});
                  for (var i=0;i<keys.length && !st;i++){
                    var tracked = global.SHIPS_TRACK[keys[i]];
                    if (tracked && tracked.id == id) st = tracked;
                  }
                  
                  if (!st) {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§c[Ships] Ship not tracked: '+id);
                    }
                    return 0;
                  }
                  
                  if (st.decaying) {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§e[Ships] Ship '+id+' is already decaying');
                    }
                  } else {
                    if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                      ctx.source.server.tell('§6[Ships] Manually triggering decay for ship '+id);
                    }
                    // Force decay start (bypassing pirate check)
                    st.decaying = true;
                    st.decayStartTime = Date.now();
                    st.decayBounds = { minX: -50, minY: 0, minZ: -50, maxX: 50, maxY: 20, maxZ: 50 };
                    st.decayCurrentY = 0;
                    st.decayProgress = 0;
                  }
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] Decay error: ' + e);
                  }
                }
                return 1;
              })
          )
          .then(
            Commands.literal('test_barrels')
              .executes(ctx => {
                try {
                  var p = ctx.source.player;
                  if (!p) { ctx.source.server.tell('§cPlayer required'); return 0; }
                  
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§6[Ships] Testing functional salvage barrel system...');
                  }
                  
                  // Test barrel creation directly at player position (bypassing ship coordinate conversion)
                  var pos = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
                  global._testCreateBarrelShipsAt(p.level, pos.x, pos.y, pos.z);
                  
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§a[Ships] Test salvage barrels created at your position - check around you!');
                  }
                  
                } catch (e) {
                  if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                    ctx.source.server.tell('§c[Ships] Test barrel error: ' + e);
                  }
                }
                return 1;
              })
          )
          .then(
            Commands.literal('barrels')
              .then(
                Commands.literal('status')
                  .executes(ctx => {
                    try {
                      var barrelCount = Object.keys(global.BARREL_TRACK || {}).length;
                      var CFG = global.Ships_CFG;
                      var despawnMinutes = CFG ? CFG.BARREL_DESPAWN_MINUTES : 30;
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§6[Ships] Barrel Status:');
                        ctx.source.server.tell('§7- Tracked barrels: §f' + barrelCount);
                        ctx.source.server.tell('§7- Despawn time: §f' + (despawnMinutes > 0 ? despawnMinutes + ' minutes' : 'disabled'));
                      }
                      
                      if (barrelCount > 0) {
                        var currentTime = Date.now();
                        var oldestAge = 0;
                        var newestAge = Infinity;
                        
                        Object.keys(global.BARREL_TRACK).forEach(function(barrelId) {
                          var barrel = global.BARREL_TRACK[barrelId];
                          if (barrel && barrel.createTime) {
                            var age = (currentTime - barrel.createTime) / 60000; // minutes
                            oldestAge = Math.max(oldestAge, age);
                            newestAge = Math.min(newestAge, age);
                          }
                        });
                        
                        if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                          ctx.source.server.tell('§7- Age range: §f' + newestAge.toFixed(1) + ' - ' + oldestAge.toFixed(1) + ' minutes');
                        }
                      }
                    } catch (e) {
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§c[Ships] Barrel status error: ' + e);
                      }
                    }
                    return 1;
                  })
              )
              .then(
                Commands.literal('cleanup')
                  .executes(ctx => {
                    try {
                      var barrelCount = Object.keys(global.BARREL_TRACK || {}).length;
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§6[Ships] Cleaning up ' + barrelCount + ' tracked barrels...');
                      }
                      global._cleanupAllBarrels();
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§a[Ships] Barrel cleanup completed');
                      }
                    } catch (e) {
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§c[Ships] Barrel cleanup error: ' + e);
                      }
                    }
                    return 1;
                  })
              )
              .then(
                Commands.literal('process')
                  .executes(ctx => {
                    try {
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§6[Ships] Processing barrel cleanup (age-based)...');
                      }
                      global._processBarrelCleanup();
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§a[Ships] Barrel processing completed');
                      }
                    } catch (e) {
                      if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
                        ctx.source.server.tell('§c[Ships] Barrel process error: ' + e);
                      }
                    }
                    return 1;
                  })
              )
          )
      )
  );
});
